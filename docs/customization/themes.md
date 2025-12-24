# Theme Configuration

This directory contains all theme configurations in JSON format. This includes both built-in themes that ship with Athas, and custom themes that users can create.

## Theme File Format

Each JSON file can contain one or more themes. Here's the basic structure:

```json
{
  "themes": [
    {
      "id": "unique-theme-id",
      "name": "Display Name",
      "description": "Theme description",
      "category": "Light",
      "isDark": true,
      "cssVariables": {
        "--primary-bg": "#color",
        "--secondary-bg": "#color",
        "--text": "#color"
      },
      "syntaxTokens": {
        "--syntax-keyword": "#color",
        "--syntax-string": "#color"
      }
    }
  ]
}
```

## Required Fields

- `id`: Unique identifier for the theme
- `name`: Display name shown in the UI
- `description`: Brief description of the theme
- `category`: Must be "Light", "Dark", or "System"
- `cssVariables`: Object containing CSS variables for theme colors

## Optional Fields

- `isDark`: Boolean indicating if this is a dark theme (defaults to false for Light, true for Dark)
- `syntaxTokens`: Object containing syntax highlighting colors

## CSS Variables

The following CSS variables are supported:

### Background Colors
- `--primary-bg`: Main background color
- `--secondary-bg`: Secondary background color

### Text Colors
- `--text`: Primary text color
- `--text-light`: Secondary text color
- `--text-lighter`: Tertiary text color

### UI Colors
- `--border`: Border color
- `--hover`: Hover state color
- `--selected`: Selected state color
- `--accent`: Accent/primary color
- `--cursor`: Cursor color
- `--cursor-vim-normal`: Vim normal mode cursor
- `--cursor-vim-insert`: Vim insert mode cursor

### Semantic Colors
- `--error`: Error state color
- `--warning`: Warning state color
- `--success`: Success state color
- `--info`: Info state color

### Git Colors
- `--git-modified`: Modified files
- `--git-added`: Added files
- `--git-deleted`: Deleted files
- `--git-untracked`: Untracked files
- `--git-renamed`: Renamed files

### Syntax Highlighting Colors
- `--syntax-keyword`: Keywords (if, else, function, etc.)
- `--syntax-string`: String literals
- `--syntax-number`: Number literals
- `--syntax-comment`: Comments
- `--syntax-variable`: Variables
- `--syntax-function`: Function names
- `--syntax-constant`: Constants
- `--syntax-property`: Object properties
- `--syntax-type`: Type annotations
- `--syntax-operator`: Operators (+, -, =, etc.)
- `--syntax-punctuation`: Punctuation marks
- `--syntax-boolean`: Boolean literals
- `--syntax-null`: Null/undefined
- `--syntax-regex`: Regular expressions
- `--syntax-jsx`: JSX tags
- `--syntax-jsx-attribute`: JSX attributes

### Terminal Colors
- `--terminal-black`, `--terminal-red`, `--terminal-green`, `--terminal-yellow`
- `--terminal-blue`, `--terminal-magenta`, `--terminal-cyan`, `--terminal-white`
- `--terminal-bright-black`, `--terminal-bright-red`, etc. (bright variants)

## Example

See `example-custom-theme.json` for a complete example of how to create custom themes.

## Built-in Themes

The following themes are included with Athas:
- **Athas**: Default Light and Dark variants
- **GitHub**: Light, Dark, and Dark Dimmed variants
- **VS Code**: Light and Dark variants
- **One Dark**: Original and Pro variants
- **Tokyo Night**: Original, Storm, and Moon variants
- **Dracula**: Original and Soft variants
- **Catppuccin**: Latte, Mocha, and Macchiato variants
- **Nord**: Original and Aurora variants
- **Solarized**: Light and Dark variants
- **Vitesse**: Light, Light Soft, and Dark variants
- **High Contrast**: Light, Dark, and Monochrome variants

## Creating Custom Themes

1. Create a new `.json` file in this directory
2. Define your theme(s) using the format above
3. Upload via Settings > Theme or command palette
4. Your themes will appear in the theme selector

## Color Format

All colors should be in CSS-compatible format:
- Hex: `#ff0000`, `#f00`
- RGB: `rgb(255, 0, 0)` or `rgb(255 0 0 / 0.5)`
- HSL: `hsl(0, 100%, 50%)`
- Named colors: `red`, `blue`, etc.

## Multiple Themes Per File

You can define multiple themes in a single JSON file by adding multiple objects to the `themes` array:

```json
{
  "themes": [
    {
      "id": "theme-one",
      "name": "Theme One",
      "category": "Light",
      "isDark": false,
      "cssVariables": {
        "--primary-bg": "#ffffff"
      }
    },
    {
      "id": "theme-two",
      "name": "Theme Two",
      "category": "Dark",
      "isDark": true,
      "cssVariables": {
        "--primary-bg": "#1a1a1a"
      }
    }
  ]
}
```

## JSON Schema

For better IDE support when creating themes, you can add a `$schema` property at the top of your JSON file to enable autocomplete and validation (schema file would need to be created separately).
