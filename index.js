#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const execAsync = promisify(exec);

const server = new Server(
  {
    name: 'windowssnapit-server',
    version: '2.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'take_screenshot',
        description: 'WindowsSnapIt: Advanced screenshot capture for Windows. Capture monitors, windows by title/process, with direct image return and auto-compression.',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Filename for the screenshot (default: screenshot.png). Ignored when returnDirect is true.',
              default: 'screenshot.png'
            },
            monitor: {
              type: ['string', 'number'],
              description: 'Which monitor to capture: "all" (default), "primary", or monitor number (1, 2, etc.)',
              default: 'all'
            },
            windowTitle: {
              type: 'string',
              description: 'Capture a specific window by its title (partial match supported). If multiple windows match, you\'ll get a list to choose from.'
            },
            windowIndex: {
              type: 'number',
              description: 'When multiple windows match the title, specify which one to capture (1 for first, 2 for second, etc.). Default: 1',
              default: 1,
              minimum: 1
            },
            processName: {
              type: 'string',
              description: 'Capture a specific window by process name (e.g., "notepad.exe" or just "notepad")'
            },
            folder: {
              type: 'string',
              description: 'Custom folder path to save the screenshot. Ignored when returnDirect is true.'
            },
            returnDirect: {
              type: 'boolean',
              description: 'If true, returns the image directly to Claude without saving to disk. Large images will be automatically resized and compressed to fit within 1MB limit.',
              default: true
            },
            quality: {
              type: 'number',
              description: 'JPEG quality (1-100). Only applies when returnDirect is true. Default: 80. Will be automatically reduced if needed.',
              default: 80,
              minimum: 1,
              maximum: 100
            }
          }
        }
      },
      {
        name: 'read_clipboard',
        description: 'Read the current Windows clipboard content (text or image)',
        inputSchema: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              description: 'Format to read from clipboard (auto=detect best format, text=force text, image=force image)',
              enum: ['auto', 'text', 'image'],
              default: 'auto'
            }
          },
          additionalProperties: false
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'take_screenshot') {
    const { 
      filename = 'screenshot.png', 
      monitor = 'all', 
      windowTitle, 
      windowIndex = 1,
      processName,
      folder,
      returnDirect = true,
      quality = 80
    } = args;
    
    // Check if windowIndex was explicitly provided (not just the default)
    const windowIndexProvided = args.hasOwnProperty('windowIndex');
    
    // Determine where to save the screenshot
    let screenshotsDir;
    let customFolder = false;
    
    if (folder) {
      // Convert paths based on the environment
      let windowsFolder = folder;
      
      // Running on Windows
      if (!folder.includes(':\\') && !folder.startsWith('\\\\')) {
        // Relative path - resolve it
        windowsFolder = path.resolve(folder);
      }
      // Ensure backslashes for Windows
      windowsFolder = windowsFolder.replace(/\//g, '\\');
      
      screenshotsDir = folder; // Keep original for display
      customFolder = windowsFolder;
    } else {
      // Default screenshots folder
      screenshotsDir = path.join(process.cwd(), 'screenshots');
      await fs.mkdir(screenshotsDir, { recursive: true });
    }
    
    const windowsPath = customFolder || 
      path.join(process.cwd(), 'screenshots', filename)
        .replace(/\//g, '\\');
    
    try {
      let psScript;
      
      // Simplified PowerShell that just captures and returns PNG base64
      // Build capture code without template literals to avoid nesting issues
      const windowsPathEscaped = windowsPath.replace(/\\/g, '\\\\');
      const captureCode = returnDirect ? 
          '# Return as PNG base64 for Node.js processing\n' +
          '$ms = New-Object System.IO.MemoryStream\n' +
          '$b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)\n' +
          '$base64 = [Convert]::ToBase64String($ms.ToArray())\n' +
          'Write-Output "BASE64:$base64"\n' +
          '$ms.Dispose()\n' +
          '$b.Dispose()' : 
          '# Save to file\n' +
          '$b.Save(\'' + windowsPathEscaped + '\', [System.Drawing.Imaging.ImageFormat]::Png)\n' +
          '$b.Dispose()\n' +
          'if ($graphics) { $graphics.Dispose() }';
      
      if (windowTitle || processName) {
        // Much simpler PowerShell script for window capture
        const searchTerm = windowTitle || processName;
        const searchType = windowTitle ? 'title' : 'process';
        const searchValue = searchTerm.replace(/'/g, "''");
        
        psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct R { public int L,T,Right,B; }
}
'@

# Find windows
$wins = @()
Get-Process | Where { $_.MainWindowTitle } | % {
  $match = $false
  if ('${searchType}' -eq 'title') {
    $match = $_.MainWindowTitle -like '*${searchValue}*'
  } else {
    $match = $_.ProcessName -like '*${searchValue}*' -or $_.ProcessName -like '*${searchValue}.exe*'
  }
  if ($match) {
    $wins += @{P=$_.ProcessName;T=$_.MainWindowTitle;H=$_.MainWindowHandle}
  }
}

# Handle results
if ($wins.Count -eq 0) {
  Write-Host "WINDOW_NOT_FOUND:${searchValue}"
  exit 1
} elseif ($wins.Count -gt 1 -and ${windowIndexProvided ? '$false' : '$true'}) {
  $list = ""
  for ($i=0; $i -lt $wins.Count; $i++) {
    $list += "$($i+1). $($wins[$i].T) ($($wins[$i].P).exe)\`n"
  }
  Write-Host "MULTIPLE_WINDOWS_FOUND:${searchValue}:$list"
  exit 1
}

# Select window
$w = $wins[0]
if ($wins.Count -gt 1 -and ${windowIndex} -ge 1 -and ${windowIndex} -le $wins.Count) {
  $w = $wins[${windowIndex - 1}]
}

# Capture
$h = [IntPtr]$w.H
$r = New-Object W32+R
[W32]::GetWindowRect($h, [ref]$r) | Out-Null
$width = $r.Right - $r.L
$height = $r.B - $r.T

if ($width -le 0 -or $height -le 0) {
  Write-Host "ERROR: Invalid dimensions"
  exit 1
}

[W32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 200

$b = New-Object System.Drawing.Bitmap $width,$height
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($r.L,$r.T,0,0,$b.Size)
$g.Dispose()

` + captureCode;
      } else if (monitor === 'all') {
        // Current behavior - capture all screens
        psScript = `
          try {
          $ErrorActionPreference = 'Stop'
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          # Enable per-monitor DPI awareness
          Add-Type @"
            using System.Runtime.InteropServices;
            public class DPI {
              [DllImport("shcore.dll")]
              public static extern int SetProcessDpiAwareness(int value);
            }
"@
          [DPI]::SetProcessDpiAwareness(2)
          
          $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
          $b = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
          $graphics = [System.Drawing.Graphics]::FromImage($b)
          $graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $b.Size)
          
          ` + captureCode + `
          } catch {
            Write-Output "ERROR: $_"
            exit 1
          }
        `;
      } else {
        // Capture specific monitor
        psScript = `
          try {
          $ErrorActionPreference = 'Stop'
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          
          # Enable DPI awareness - MUST be per-monitor for multi-monitor setups with scaling
          Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class DPIAware {
              [DllImport("user32.dll")]
              public static extern bool SetProcessDPIAware();
              
              [DllImport("shcore.dll")]
              public static extern int SetProcessDpiAwareness(int value);
            }
"@
          # Always use per-monitor DPI awareness (2) for accurate capture
          [DPIAware]::SetProcessDpiAwareness(2)
          
          $screens = [System.Windows.Forms.Screen]::AllScreens
          $targetScreen = $null
          
          # Sort by X position ascending (left to right) to match Windows display numbering
          $sortedScreens = $screens | Sort-Object { $_.Bounds.X }
          
          
          if ('${monitor}' -eq 'primary') {
            $targetScreen = [System.Windows.Forms.Screen]::PrimaryScreen
          } elseif ('${monitor}' -match '^\\d+$') {
            $index = [int]'${monitor}' - 1
            if ($index -ge 0 -and $index -lt $sortedScreens.Count) {
              $targetScreen = $sortedScreens[$index]
            } else {
              throw "Monitor ${monitor} not found. Available monitors: 1 to $($sortedScreens.Count)"
            }
          }
          
          if ($targetScreen -eq $null) {
            throw "Invalid monitor parameter: ${monitor}"
          }
          
          $bounds = $targetScreen.Bounds
          
          $b = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
          $graphics = [System.Drawing.Graphics]::FromImage($b)
          # Use explicit coordinates for accurate capture
          $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $b.Size)
          
          ` + captureCode + `
          } catch {
            Write-Output "ERROR: $_"
            exit 1
          }
        `;
      }
      
      // Convert to base64 to avoid escaping issues
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      
      // Execute PowerShell with encoded command (suppress CLIXML output)
      let stdout = '';
      let stderr = '';
      
      
      try {
        const result = await execAsync(
          `powershell.exe -ExecutionPolicy Bypass -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand ${encodedCommand}`,
          { maxBuffer: 50 * 1024 * 1024 } // Increase buffer for large PNG images
        );
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (error) {
        // PowerShell failed, but we still want to check stdout for our custom error messages
        stdout = error.stdout || '';
        stderr = error.stderr || '';
      }
      
      // Check for our custom error messages in both stdout and stderr
      const combinedOutput = stdout + stderr;
      
      
      if (combinedOutput.includes('MULTIPLE_WINDOWS_FOUND:')) {
        // Handle both clean output and CLIXML-wrapped output
        const match = combinedOutput.match(/MULTIPLE_WINDOWS_FOUND:([^:]+):([\s\S]+?)(?:At line:|DEBUG:|$)/);
        if (match) {
          const searchTerm = match[1].trim();
          const rawWindowList = match[2].trim();
          
          
          // Parse and reformat the window list to make it look like Claude Code's interactive prompts
          // Filter out PowerShell XML output noise and carriage returns
          const windowLines = rawWindowList
            .replace(/_x000D_/g, '') // Remove CLIXML carriage returns
            .replace(/_x000A_/g, '\n') // Convert CLIXML newlines
            .split('\n')
            .filter(line => {
              const trimmed = line.trim();
              return trimmed && 
                     !trimmed.includes('<Objs') && 
                     !trimmed.includes('</Objs>') && 
                     !trimmed.includes('<Obj') && 
                     !trimmed.includes('</Obj>') &&
                     !trimmed.includes('<S S=') &&
                     !trimmed.includes('CLIXML');
            })
            .map(line => line.replace(/^<S S="Error">/, '').replace(/_x000D_$/, '').trim())
            .filter(line => line && /^\d+\./.test(line)); // Only keep numbered items
          const lastLine = windowLines[windowLines.length - 1];
          const isLastLineCancel = lastLine.includes('Cancel capture');
          
          // Build formatted options list
          let formattedOptions = '';
          for (let i = 0; i < windowLines.length; i++) {
            const line = windowLines[i].trim();
            if (line) {
              formattedOptions += `${line}\n`;
            }
          }
          
          // Create an interactive-looking prompt message that mimics Claude Code's style
          const helpMessage = `Multiple windows found matching "${searchTerm}". Please choose an option:

${formattedOptions}
🔄 To select an option, retry the screenshot with windowIndex: 2 (for option 2)
❌ To cancel, simply don't retry the tool call

Example: \`windowIndex: 2\` to capture the second window`;
          
          throw new Error(helpMessage);
        }
      }
      
      if (combinedOutput.includes('WINDOW_NOT_FOUND:')) {
        const searchTerm = combinedOutput.match(/WINDOW_NOT_FOUND:(.+)/)?.[1]?.trim() || '';
        const helpMessage = `❌ No windows found with title containing "${searchTerm}"

💡 Suggestions:
  • Check the window's title bar for the exact text
  • Try a shorter or different part of the title
  • Use processName instead (e.g., 'notepad', 'chrome')`;
        throw new Error(helpMessage);
      }
      
      if (combinedOutput.includes('PROCESS_NOT_FOUND:')) {
        const searchTerm = combinedOutput.match(/PROCESS_NOT_FOUND:(.+)/)?.[1]?.trim() || '';
        const helpMessage = `❌ No visible windows found for process "${searchTerm}"

💡 Suggestions:
  • Make sure the application is running with visible windows
  • Try capturing by windowTitle instead of processName
  • Check if the process name is correct (without .exe extension)`;
        throw new Error(helpMessage);
      }
      
      // Check for direct return base64 data
      if (returnDirect) {
        if (!stdout.includes('BASE64:')) {
          throw new Error('Failed to generate base64 output from PowerShell');
        }
        
        // Extract base64 data
        const base64Start = stdout.indexOf('BASE64:') + 7;
        let base64Data = stdout.substring(base64Start).trim();
        
        // Remove any trailing PowerShell output or newlines
        const errorIndex = base64Data.indexOf('ERROR:');
        if (errorIndex > 0) {
          base64Data = base64Data.substring(0, errorIndex).trim();
        }
        
        // Process the PNG with sharp
        const pngBuffer = Buffer.from(base64Data, 'base64');
        
        // Dynamic compression with sharp
        const maxSizeBytes = 950 * 1024; // 950KB target
        const metadata = await sharp(pngBuffer).metadata();
        
        let processedImage = sharp(pngBuffer);
        let finalBuffer;
        let finalQuality = quality;
        let wasResized = false;
        
        // First, check if resize is needed based on width
        if (metadata.width > 1920) {
          processedImage = processedImage.resize({ width: 1920 });
          wasResized = true;
        }
        
        // Try with the requested quality first
        finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
        
        // If still too large, progressively reduce quality
        while (finalBuffer.length > maxSizeBytes && finalQuality > 20) {
          finalQuality -= 10;
          finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
        }
        
        // If still too large after quality reduction, apply more aggressive resize
        if (finalBuffer.length > maxSizeBytes) {
          processedImage = sharp(pngBuffer).resize({ width: 1280 });
          wasResized = true;
          finalQuality = 60;
          finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
          
          // Final attempt with even smaller size
          if (finalBuffer.length > maxSizeBytes) {
            processedImage = sharp(pngBuffer).resize({ width: 800 });
            finalQuality = 50;
            finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
          }
        }
        
        const compressedBase64 = finalBuffer.toString('base64');
        const sizeInKB = Math.round(finalBuffer.length / 1024);
        
        let statusText = `Screenshot captured successfully (${sizeInKB}KB, JPEG quality: ${finalQuality}%)`;
        if (wasResized) {
          const finalMeta = await sharp(finalBuffer).metadata();
          statusText += ` - Resized to ${finalMeta.width}px width`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: statusText
            },
            {
              type: 'image',
              data: compressedBase64,
              mimeType: 'image/jpeg'
            }
          ]
        };
      }
      
      // Check for other PowerShell errors (fallback)
      const hasRealError = stderr && (
          stderr.includes('throw') ||
          stderr.includes('Exception') ||
          stderr.includes('ERROR:') ||
          (stderr.includes('Error') && !stderr.includes('ErrorId'))
      );
          
      if (hasRealError) {
        // Extract clean error message
        if (stderr.includes('ERROR:')) {
          const errorMatch = stderr.match(/ERROR:\s*(.+)/);
          if (errorMatch) {
            throw new Error(errorMatch[1].trim());
          }
        }
        // Fallback to generic error
        throw new Error('Screenshot capture failed');
      }
      
      // For file saving mode, verify file was created
      if (!returnDirect) {
        const outputPath = path.join(screenshotsDir, filename);
        await fs.access(outputPath);
        
        // Generate appropriate success message based on folder used
        let successPath;
        if (customFolder) {
          // Show the custom folder path as provided by the user
          successPath = path.join(customFolder, filename).replace(/\\/g, '/');
        } else {
          // Show relative path for default screenshots folder
          successPath = `screenshots/${filename}`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot saved successfully to: ${successPath}`
            }
          ]
        };
      }
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }
  
  if (name === 'read_clipboard') {
    const { format = 'auto' } = args;
    
    try {
      // PowerShell script for clipboard reading
      let psScript = `
        try {
          $ErrorActionPreference = 'Stop'
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          
          # Check clipboard content based on format parameter
          $format = '${format}'
          $hasText = [System.Windows.Forms.Clipboard]::ContainsText()
          $hasImage = [System.Windows.Forms.Clipboard]::ContainsImage()
          
          if ($format -eq 'auto') {
            # Auto-detect: prefer image over text
            if ($hasImage) {
              $format = 'image'
            } elseif ($hasText) {
              $format = 'text'
            } else {
              Write-Output "EMPTY_CLIPBOARD"
              exit 0
            }
          }
          
          if ($format -eq 'text') {
            if (-not $hasText) {
              Write-Output "NO_TEXT_IN_CLIPBOARD"
              exit 0
            }
            $clipboardText = Get-Clipboard -Raw
            if ($null -eq $clipboardText) {
              Write-Output "EMPTY_CLIPBOARD"
              exit 0
            }
            # Output text with a marker for parsing
            Write-Output "TEXT_CONTENT:$clipboardText"
          }
          elseif ($format -eq 'image') {
            if (-not $hasImage) {
              Write-Output "NO_IMAGE_IN_CLIPBOARD"
              exit 0
            }
            
            $image = [System.Windows.Forms.Clipboard]::GetImage()
            if ($null -eq $image) {
              Write-Output "NO_IMAGE_IN_CLIPBOARD"
              exit 0
            }
            
            # Convert image to PNG and base64
            $ms = New-Object System.IO.MemoryStream
            $image.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $base64 = [Convert]::ToBase64String($ms.ToArray())
            Write-Output "BASE64:$base64"
            $ms.Dispose()
            $image.Dispose()
          }
        } catch {
          Write-Output "ERROR: $_"
          exit 1
        }
      `;
      
      // Convert to base64 to avoid escaping issues
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      
      // Execute PowerShell
      const { stdout, stderr } = await execAsync(
        `powershell.exe -ExecutionPolicy Bypass -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand ${encodedCommand}`,
        { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for large images
      );
      
      // Handle empty clipboard
      if (stdout.includes('EMPTY_CLIPBOARD')) {
        return {
          content: [
            {
              type: 'text',
              text: 'Clipboard is empty'
            }
          ]
        };
      }
      
      // Handle no text when text requested
      if (stdout.includes('NO_TEXT_IN_CLIPBOARD')) {
        return {
          content: [
            {
              type: 'text',
              text: 'No text content in clipboard (clipboard may contain an image or other format)'
            }
          ]
        };
      }
      
      // Handle no image when image requested
      if (stdout.includes('NO_IMAGE_IN_CLIPBOARD')) {
        return {
          content: [
            {
              type: 'text',
              text: 'No image content in clipboard (clipboard may contain text or other format)'
            }
          ]
        };
      }
      
      // Handle text content
      if (stdout.includes('TEXT_CONTENT:')) {
        const textStart = stdout.indexOf('TEXT_CONTENT:') + 13;
        const clipboardText = stdout.substring(textStart).trim();
        
        return {
          content: [
            {
              type: 'text',
              text: `Clipboard text content:\n\n${clipboardText}`
            }
          ]
        };
      }
      
      // Handle image content
      if (stdout.includes('BASE64:')) {
        // Extract base64 data
        const base64Start = stdout.indexOf('BASE64:') + 7;
        let base64Data = stdout.substring(base64Start).trim();
        
        // Remove any trailing PowerShell output
        const errorIndex = base64Data.indexOf('ERROR:');
        if (errorIndex > 0) {
          base64Data = base64Data.substring(0, errorIndex).trim();
        }
        
        // Reuse the existing image compression pipeline from screenshot
        const pngBuffer = Buffer.from(base64Data, 'base64');
        
        // Dynamic compression with sharp
        const maxSizeBytes = 950 * 1024; // 950KB target
        const metadata = await sharp(pngBuffer).metadata();
        
        let processedImage = sharp(pngBuffer);
        let finalBuffer;
        let finalQuality = 80; // Default quality
        let wasResized = false;
        
        // First, check if resize is needed based on width
        if (metadata.width > 1920) {
          processedImage = processedImage.resize({ width: 1920 });
          wasResized = true;
        }
        
        // Try with the default quality first
        finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
        
        // If still too large, progressively reduce quality
        while (finalBuffer.length > maxSizeBytes && finalQuality > 20) {
          finalQuality -= 10;
          finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
        }
        
        // If still too large after quality reduction, apply more aggressive resize
        if (finalBuffer.length > maxSizeBytes) {
          processedImage = sharp(pngBuffer).resize({ width: 1280 });
          wasResized = true;
          finalQuality = 60;
          finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
          
          // Final attempt with even smaller size
          if (finalBuffer.length > maxSizeBytes) {
            processedImage = sharp(pngBuffer).resize({ width: 800 });
            finalQuality = 50;
            finalBuffer = await processedImage.jpeg({ quality: finalQuality, mozjpeg: true }).toBuffer();
          }
        }
        
        const compressedBase64 = finalBuffer.toString('base64');
        const sizeInKB = Math.round(finalBuffer.length / 1024);
        
        let statusText = `Clipboard image retrieved successfully (${sizeInKB}KB, JPEG quality: ${finalQuality}%)`;
        if (wasResized) {
          const finalMeta = await sharp(finalBuffer).metadata();
          statusText += ` - Resized to ${finalMeta.width}px width`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: statusText
            },
            {
              type: 'image',
              data: compressedBase64,
              mimeType: 'image/jpeg'
            }
          ]
        };
      }
      
      // Handle errors
      if (stdout.includes('ERROR:') || stderr) {
        const errorMatch = stdout.match(/ERROR:\s*(.+)/);
        const errorMessage = errorMatch ? errorMatch[1].trim() : stderr || 'Unknown error';
        throw new Error(errorMessage);
      }
      
      // Fallback
      throw new Error('Unable to read clipboard content');
      
    } catch (error) {
      throw new Error(`Failed to read clipboard: ${error.message}`);
    }
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('WindowsSnapIt MCP server running...');
