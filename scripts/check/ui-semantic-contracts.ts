import ts from "typescript";

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}

function objectPropertyNames(node: ts.ObjectLiteralExpression) {
  return new Set(node.properties.map(propertyName).filter((name): name is string => !!name));
}

function hasTrueProperty(node: ts.ObjectLiteralExpression, name: string) {
  return node.properties.some(
    (property) =>
      propertyName(property) === name &&
      ts.isPropertyAssignment(property) &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

function report(
  errors: string[],
  path: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  errors.push(`${path}:${line + 1}: ${message}`);
}

function inspectObjectLiteral(
  errors: string[],
  path: string,
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
) {
  const names = objectPropertyNames(node);
  const hasMenuProperty = [
    "onClick",
    "className",
    "keybinding",
    "shortcut",
    "trailing",
    "checked",
    "selected",
    "tone",
    "disabled",
  ].some((name) => names.has(name));
  const looksLikeMenuItem = names.has("id") && names.has("label") && hasMenuProperty;
  const isMenuSeparator = names.has("id") && hasTrueProperty(node, "separator");
  const looksLikeFileNavigatorItem = names.has("key") && names.has("path");

  if (isMenuSeparator) {
    for (const property of node.properties) {
      const name = propertyName(property);
      if (name === "label" || name === "onClick") {
        report(
          errors,
          path,
          sourceFile,
          property,
          "menu separators must not carry labels or click handlers",
        );
      }
    }
  }

  if (looksLikeMenuItem) {
    for (const property of node.properties) {
      const name = propertyName(property);
      if (name === "className") {
        report(
          errors,
          path,
          sourceFile,
          property,
          "menu items must use semantic tone or selected props instead of className",
        );
      }
      if (name === "keybinding") {
        report(
          errors,
          path,
          sourceFile,
          property,
          "menu shortcuts must use the canonical shortcut string prop",
        );
      }
    }
  }

  if (looksLikeFileNavigatorItem) {
    for (const property of node.properties) {
      const name = propertyName(property);
      if (name === "iconClassName") {
        report(
          errors,
          path,
          sourceFile,
          property,
          "file navigator icons must use iconTone instead of iconClassName",
        );
      }

      if (
        name === "metadata" &&
        ts.isPropertyAssignment(property) &&
        ts.isArrayLiteralExpression(property.initializer)
      ) {
        for (const element of property.initializer.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const metadataNames = objectPropertyNames(element);
          if (metadataNames.has("className")) {
            report(
              errors,
              path,
              sourceFile,
              element,
              "file navigator metadata must use tone instead of className",
            );
          }
        }
      }
    }
  }
}

function inspectJsxOpeningElement(
  errors: string[],
  path: string,
  sourceFile: ts.SourceFile,
  node: ts.JsxOpeningLikeElement,
) {
  if (!ts.isIdentifier(node.tagName) || node.tagName.text !== "Select") return;

  for (const property of node.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "menuClassName"
    ) {
      report(
        errors,
        path,
        sourceFile,
        property,
        "select menus must use semantic sizing props instead of menuClassName",
      );
    }
  }
}

export function findUiSemanticContractViolations(path: string, source: string): string[] {
  const errors: string[] = [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      inspectObjectLiteral(errors, path, sourceFile, node);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      inspectJsxOpeningElement(errors, path, sourceFile, node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return errors;
}

if (import.meta.main) {
  const sourceGlob = new Bun.Glob("src/{features,extensions}/**/*.{ts,tsx}");
  const errors: string[] = [];

  for await (const path of sourceGlob.scan({ cwd: ".", onlyFiles: true })) {
    errors.push(...findUiSemanticContractViolations(path, await Bun.file(path).text()));
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  console.log("UI semantic contract checks passed.");
}
