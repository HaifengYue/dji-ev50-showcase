from pathlib import Path
p=Path('threejs/src/flight.ts');s=p.read_text();s=s.replace('readonly duration=50','readonly duration=frames[frames.length-1].t');p.write_text(s)
p=Path('threejs/src/main.ts');s=p.read_text();s=s.replace('flight.time>=50','flight.time>=flight.duration').replace("+' / 50.0 s'","+' / '+flight.duration.toFixed(1)+' s'");s=s.replace('ready=true;flight.evaluate();',"ready=true;flight.evaluate();$<HTMLInputElement>('#timeline').max=String(flight.duration);");p.write_text(s)
p=Path('threejs/test-flight.mjs');s=p.read_text().replace('49.9','59.9').replace('c.time,50','c.time,60').replace('%50','%60');p.write_text(s)
p=Path('blender/build_model.py');s=p.read_text();s=s.replace('mod.voxel_size=.018','mod.voxel_size=.008 if V>=4 else .018').replace('mod.ratio=.42','mod.ratio=.72 if V>=4 else .42');s=s.replace('co.x*3.5+co.z*3.5,co.y*3.5','co.x*12+co.z*12,co.y*12');s=s.replace("o=box(lab+'_Aileron',(s*2.22,.135,.899),(1.31,.055,.01),carbon,.003);o['part']='aileron'", "o=wing(lab+'_Aileron',[(s*1.5,.127,.037,.891,.004),(s*2.65,.081,.037,.900,.004),(s*3.32,.058,.025,.926,.003)],carbon);o['part']='aileron'")
# Fair the remeshed shell without sharpening voxel noise.
s=s.replace("# Texture UVs tied", "if V>=4:\n  sub=hull.modifiers.new('Final_Surface_Fairing','SUBSURF');sub.levels=1;sub.render_levels=1\n # Texture UVs tied")
p.write_text(s)
