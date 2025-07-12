# WindowsSnapIt-MCP 📸

Advanced screenshot capture and clipboard reading MCP (Model Context Protocol) server for Windows applications. Enables AI assistants like Claude to capture screens, windows, and read clipboard content with intelligent image processing and optimization.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![MCP](https://img.shields.io/badge/MCP-v2.0-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)

## 🌟 Key Features

- **🖼️ Advanced Screenshot Capture** - Capture entire screens, specific monitors, or individual windows
- **📋 Clipboard Reading** - Access text and images from Windows clipboard
- **🔧 Smart Compression** - Automatic image optimization to meet MCP size limits
- **🎯 Window Targeting** - Find windows by title or process name
- **⚡ High Performance** - Optimized for speed with progressive compression
- **🔒 Secure** - Runs locally with no external dependencies

## 🛠️ MCP Tools

This server provides two powerful tools for AI assistants:

### 📸 `take_screenshot`

Captures screenshots with multiple targeting options and intelligent compression.

**Parameters:**
- `monitor` (string/number): Target monitor - `"all"` (default), `"primary"`, or monitor number (1, 2, 3...)
- `windowTitle` (string): Capture window by title (partial match supported)
- `processName` (string): Capture window by process name (e.g., "notepad", "chrome")
- `windowIndex` (number): When multiple windows match, specify which one (default: 1)
- `returnDirect` (boolean): Return image directly to AI (default: true) or save to disk
- `quality` (number): JPEG quality 1-100 (default: 80)
- `filename` (string): Output filename when saving (default: "screenshot.png")
- `folder` (string): Custom save folder path

**Usage Examples:**
```javascript
// Capture all monitors
await use_mcp_tool("windowssnapit", "take_screenshot", {});

// Capture primary monitor only
await use_mcp_tool("windowssnapit", "take_screenshot", {
  monitor: "primary"
});

// Capture a specific window
await use_mcp_tool("windowssnapit", "take_screenshot", {
  windowTitle: "Visual Studio Code"
});

// Capture by process name
await use_mcp_tool("windowssnapit", "take_screenshot", {
  processName: "notepad"
});

// Save to file instead of returning
await use_mcp_tool("windowssnapit", "take_screenshot", {
  returnDirect: false,
  filename: "my-capture.png",
  folder: "C:\\Screenshots"
});

// Handle multiple matching windows
await use_mcp_tool("windowssnapit", "take_screenshot", {
  windowTitle: "Chrome",
  windowIndex: 2  // Capture the second Chrome window
});
```

### 📋 `read_clipboard`

Reads content from the Windows clipboard, automatically detecting text or image data.

**Parameters:**
- `format` (string): Content format - `"auto"` (default), `"text"`, or `"image"`

**Usage Examples:**
```javascript
// Auto-detect clipboard content
await use_mcp_tool("windowssnapit", "read_clipboard", {});

// Force text reading
await use_mcp_tool("windowssnapit", "read_clipboard", {
  format: "text"
});

// Force image reading
await use_mcp_tool("windowssnapit", "read_clipboard", {
  format: "image"
});
```

## 🚀 Quick Start

### Prerequisites
- Windows 10/11
- Node.js 18.0.0 or higher
- npm, yarn, or bun package manager

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/WindowsSnapIt-MCP.git
cd WindowsSnapIt-MCP
```

2. **Install dependencies:**
```bash
npm install
# or
bun install
```

3. **Configure in Claude Desktop:**

Add to your Claude Desktop configuration file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "windowssnapit": {
      "command": "node",
      "args": ["C:\\path\\to\\WindowsSnapIt-MCP\\index.js"]
    }
  }
}
```

4. **Restart Claude Desktop** to load the MCP server.

## 💡 Usage Tips

### Window Capture Best Practices
- Use partial window titles for flexibility (e.g., "Visual Studio" matches "Visual Studio Code")
- Process names work without the .exe extension
- If multiple windows match, you'll get a helpful list to choose from
- Windows must be visible (not minimized) to be captured

### Image Quality & Size
- Images are automatically compressed to stay under 1MB (MCP limit)
- Default quality is 80%, automatically reduced if needed
- Large screenshots are progressively resized: 1920px → 1280px → 800px
- Status messages indicate if resizing occurred

### Performance
- Full screen capture: 200-500ms
- Window capture: 150-300ms
- Clipboard read: 50-150ms
- Compression adds 100-400ms for large images

## 🏗️ Architecture

### Technology Stack
- **Node.js 18+** with ES modules
- **@modelcontextprotocol/sdk** for MCP implementation
- **Sharp** for image processing with mozjpeg
- **PowerShell** for Windows API integration

### Key Design Decisions
- **Single-file architecture** for easy deployment
- **Progressive compression** to handle any screen size
- **DPI-aware** capture for high-resolution displays
- **Zero external dependencies** for Windows functionality

## 🔒 Security Considerations

- **Local only** - No network access or external APIs
- **Process isolation** - PowerShell runs in separate process
- **Input validation** - All parameters properly sanitized
- **No data storage** - Images processed in memory only

**Note:** This tool can capture any visible content. Use responsibly and be aware of sensitive information in screenshots or clipboard.

## 🐛 Troubleshooting

### Common Issues

**"Window not found" error**
- Ensure the window is visible and not minimized
- Try a shorter or different part of the title
- Use process name instead of window title

**Large screenshots fail**
- The tool automatically handles this, but you can:
- Lower the quality parameter
- Capture a specific window instead of full screen

**Clipboard is empty**
- Ensure content is properly copied
- Try specifying format explicitly

### Debug Mode
```bash
DEBUG=* node index.js
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for [Claude Desktop](https://claude.ai) using the [Model Context Protocol](https://modelcontextprotocol.io)
- Image processing powered by [Sharp](https://sharp.pixelplumbing.com/)
- Thanks to Anthropic for the MCP specification

## 📞 Support

- 🐛 [Report bugs](https://github.com/yourusername/WindowsSnapIt-MCP/issues)
- 💡 [Request features](https://github.com/yourusername/WindowsSnapIt-MCP/discussions)
- 📖 [MCP Documentation](https://modelcontextprotocol.io/docs)

---

Made with ❤️ for the Windows and MCP community