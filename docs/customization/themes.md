# Theme Configuration

This directory contains all theme configurations in TOML format. This includes both built-in themes that ship with Athas, and custom themes that users can create.

## Theme File Format

Each TOML file can contain one or more themes. Here's the basic structure:

```toml
[[themes]]
id = "unique-theme-id"
name = "Display Name"
description = "Theme description"
category = "Light" # or "Dark" or "System"
is_dark = true # optional boolean

[themes.css_variables]
"--tw-primary-bg" = "#color"
"--tw-secondary-bg" = "#color"
"--tw-text" = "#color"
# ... more CSS variables

[themes.syntax_tokens]
"--color-syntax-keyword" = "#color"
"--color-syntax-string" = "#color"
# ... more syntax highlighting colors
```

## Required Fields

- `id`: Unique identifier for the theme
- `name`: Display name shown in the UI
- `description`: Brief description of the theme
- `category`: Must be "Light", "Dark", or "System"

## Optional Fields

- `is_dark`: Boolean indicating if this is a dark theme
- `syntax_tokens`: Object containing syntax highlighting colors

## CSS Variables

The following CSS variables are supported:

### Background Colors
- `--tw-primary-bg`: Main background color
- `--tw-secondary-bg`: Secondary background color

### Text Colors
- `--tw-text`: Primary text color
- `--tw-text-light`: Secondary text color
- `--tw-text-lighter`: Tertiary text color

### UI Colors
- `--tw-border`: Border color
- `--tw-hover`: Hover state color
- `--tw-selected`: Selected state color
- `--tw-accent`: Accent/primary color

### Syntax Highlighting Colors
- `--color-syntax-keyword`: Keywords (if, else, function, etc.)
- `--color-syntax-string`: String literals
- `--color-syntax-number`: Number literals
- `--color-syntax-comment`: Comments
- `--color-syntax-variable`: Variables
- `--color-syntax-function`: Function names
- `--color-syntax-constant`: Constants
- `--color-syntax-property`: Object properties
- `--color-syntax-type`: Type annotations
- `--color-syntax-operator`: Operators (+, -, =, etc.)
- `--color-syntax-punctuation`: Punctuation marks
- `--color-syntax-boolean`: Boolean literals
- `--color-syntax-null`: Null/undefined
- `--color-syntax-regex`: Regular expressions
- `--color-syntax-jsx`: JSX tags
- `--color-syntax-jsx-attribute`: JSX attributes

## Example

See `example-custom-theme.toml` for a complete example of how to create custom themes.

## Built-in Themes

The following themes are included with Athas:
- **GitHub**: Light, Dark, and Dark Dimmed variants
- **VS Code**: Light and Dark variants  
- **One Dark**: Original and Pro variants
- **Tokyo Night**: Original, Storm, and Moon variants
- **Dracula**: Original and Soft variants
- **Catppuccin**: Latte, Mocha, and Macchiato variants
- **Nord**: Original and Aurora variants
- **Solarized**: Light and Dark variants
- **High Contrast**: Light, Dark, and Monochrome variants

## Creating Custom Themes

1. Create a new `.toml` file in this directory
2. Define your theme(s) using the format above
3. Restart the application or reload themes
4. Your themes will appear in the theme selector

## Color Format

All colors should be in CSS-compatible format:
- Hex: `#ff0000`, `#f00`
- RGB: `rgb(255, 0, 0)`
- HSL: `hsl(0, 100%, 50%)`
- Named colors: `red`, `blue`, etc.

## Multiple Themes Per File

You can define multiple themes in a single TOML file by using multiple `[[themes]]` sections:

```toml
[[themes]]
id = "theme-one"
name = "Theme One"
# ... theme configuration

[[themes]]
id = "theme-two" 
name = "Theme Two"
# ... theme configuration
```