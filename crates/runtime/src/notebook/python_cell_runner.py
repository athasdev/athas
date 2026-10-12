import ast
import contextlib
import base64
import io
import json
import sys
import traceback

setup_code = sys.argv[1] if len(sys.argv) > 1 else ""
cell_code = sys.argv[2] if len(sys.argv) > 2 else ""
namespace = {}
display_data = []

def encode_bytes(value):
    return base64.b64encode(value).decode("ascii")

def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2)

def normalize_mime_value(mime, value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return encode_bytes(value)
    if isinstance(value, bytearray):
        return encode_bytes(bytes(value))
    if isinstance(value, (list, tuple)) and mime.startswith("text/"):
        return "".join(str(item) for item in value)
    if isinstance(value, (dict, list, tuple, int, float, bool)):
        return json_text(value)
    return str(value)

def normalize_bundle(bundle):
    metadata = {}
    data = bundle
    if isinstance(bundle, tuple):
        data = bundle[0]
        if len(bundle) > 1 and isinstance(bundle[1], dict):
            metadata = bundle[1]
    if not isinstance(data, dict):
        return None

    normalized = {}
    for mime, value in data.items():
        normalized_value = normalize_mime_value(mime, value)
        if normalized_value is not None:
            normalized[str(mime)] = normalized_value
    if not normalized:
        return None
    return {"data": normalized, "metadata": metadata}

def object_mime_bundle(value):
    if value is None:
        return None

    if hasattr(value, "_repr_mimebundle_"):
        try:
            bundle = normalize_bundle(value._repr_mimebundle_())
            if bundle:
                return bundle
        except Exception:
            pass

    data = {}
    metadata = {}
    repr_methods = [
        ("text/html", "_repr_html_"),
        ("text/markdown", "_repr_markdown_"),
        ("image/svg+xml", "_repr_svg_"),
        ("image/png", "_repr_png_"),
        ("image/jpeg", "_repr_jpeg_"),
        ("text/latex", "_repr_latex_"),
        ("application/json", "_repr_json_"),
    ]
    for mime, method_name in repr_methods:
        method = getattr(value, method_name, None)
        if not method:
            continue
        try:
            result = method()
            if isinstance(result, tuple):
                result, result_metadata = result
                if isinstance(result_metadata, dict):
                    metadata[mime] = result_metadata
            normalized_value = normalize_mime_value(mime, result)
            if normalized_value is not None:
                data[mime] = normalized_value
        except Exception:
            pass

    if isinstance(value, (dict, list, tuple, int, float, bool)):
        data.setdefault("application/json", json_text(value))

    data.setdefault("text/plain", repr(value))
    return {"data": data, "metadata": metadata}

def append_display(value, output_type):
    bundle = object_mime_bundle(value)
    if not bundle:
        return
    display_data.append({
        "outputType": output_type,
        "data": bundle["data"],
        "metadata": bundle["metadata"],
    })

def display(*objects, **kwargs):
    for value in objects:
        append_display(value, "display_data")

try:
    import IPython.display as ipython_display
    ipython_display.display = display
except Exception:
    pass

namespace["display"] = display

def run_code(code, capture, capture_result=False):
    if not code.strip():
        return
    with contextlib.redirect_stdout(capture["stdout"]), contextlib.redirect_stderr(capture["stderr"]):
        if not capture_result:
            exec(code, namespace, namespace)
            return

        tree = ast.parse(code, mode="exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            body = ast.Module(body=tree.body[:-1], type_ignores=[])
            expr = ast.Expression(tree.body[-1].value)
            exec(compile(body, "<athas-cell>", "exec"), namespace, namespace)
            result = eval(compile(expr, "<athas-cell>", "eval"), namespace, namespace)
            if result is not None:
                append_display(result, "execute_result")
        else:
            exec(compile(tree, "<athas-cell>", "exec"), namespace, namespace)

setup_capture = {"stdout": io.StringIO(), "stderr": io.StringIO()}
cell_capture = {"stdout": io.StringIO(), "stderr": io.StringIO()}

def close_matplotlib_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return
    plt.close("all")

def collect_matplotlib_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return

    for number in plt.get_fignums():
        figure = plt.figure(number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight")
        display_data.append({
            "outputType": "display_data",
            "data": {
                "image/png": base64.b64encode(buffer.getvalue()).decode("ascii"),
                "text/plain": f"<Figure size {figure.get_size_inches()[0]}x{figure.get_size_inches()[1]}>",
            },
            "metadata": {},
        })

try:
    run_code(setup_code, setup_capture)
    display_data.clear()
    close_matplotlib_figures()
    run_code(cell_code, cell_capture, capture_result=True)
    collect_matplotlib_figures()
    status = 0
except Exception:
    status = 1
    cell_capture["stderr"].write(traceback.format_exc())

print(json.dumps({
    "stdout": cell_capture["stdout"].getvalue(),
    "stderr": cell_capture["stderr"].getvalue(),
    "status": status,
    "displayData": display_data,
}))
