"""Export the canonical EV50 visual asset and its stable preview set.

Run with: D:\\blender\\blender.exe -b --python blender/export_aircraft.py
The source blend is edited in place only to maintain neutral asset metadata.
"""

from pathlib import Path
import shutil
import bpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "models" / "ev50.blend"
MODEL = ROOT / "models" / "ev50.glb"
RUNTIME = ROOT / "threejs" / "public" / "ev50.glb"

if not SOURCE.exists():
    raise FileNotFoundError(f"Missing canonical source: {SOURCE}")

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
aircraft = bpy.data.objects.get("EV50_Root")
if aircraft is None:
    raise RuntimeError("EV50_Root was not found")
aircraft.pop("visual_asset_version", None)
aircraft["visual_asset_name"] = "EV50"
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))

bpy.ops.object.select_all(action="DESELECT")
aircraft.select_set(True)
for object_ in aircraft.children_recursive:
    object_.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(MODEL),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_extras=True,
    export_tangents=False,
)
RUNTIME.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(MODEL, RUNTIME)
print(f"EXPORTED {MODEL} and {RUNTIME}")
