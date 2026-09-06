"""Build the photo-referenced Benavento shell. Run in Blender's Python environment.

The 28 x 28 x 8 m envelope is published; structure and landscape are photo estimates.
Furniture is imported from the app export and kept separate from the shell GLB.
"""
import bpy
import math
import random
import json
import io
from pathlib import Path
from contextlib import redirect_stdout
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
TEXTURES = ROOT / 'public/venue/textures'
OUTPUT = ROOT / 'assets/blender'
rng = random.Random(8704)
scene = bpy.context.scene
if not scene.name.startswith('Benavento Terrace | Studio'):
    scene = bpy.data.scenes.new('Benavento Terrace | Studio')
    bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
for obj in list(scene.objects):
    if obj.type in {'LIGHT', 'CAMERA'} and obj.name.startswith(('Late afternoon sun', 'Reception interior', 'Garden facade', 'Planning overview')):
        bpy.data.objects.remove(obj, do_unlink=True)
# This script owns the imported concept shell only, never the editable table groups.
old_shell = next((o for o in scene.objects if o.get('widthMetres') == 28), None)
if old_shell is None:
    with redirect_stdout(io.StringIO()):
        bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/venue/benavento-terrace-concept.glb'))
    old_shell = next(o for o in scene.objects if o.get('widthMetres') == 28)
for obj in list(old_shell.children_recursive) + [old_shell]:
    bpy.data.objects.remove(obj, do_unlink=True)


def empty(name, parent=None):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.parent = parent
    return o

shell = empty('Benavento detailed shell')
shell['widthMetres'] = 28
shell['depthMetres'] = 28
shell['heightMetres'] = 8
shell['geometry'] = 'Photo-referenced reconstruction; structure, planting and landscape inferred, not surveyed.'
shell['source'] = 'https://benavento.com/espacios-para-eventos/'
shell['assetVersion'] = 1
roof = empty('roof', shell)


def mat(name, color, rough=.5, metal=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*color, 1)
    return m

steel = mat('Graphite powder-coated steel', (.026,.033,.033), .3, .7)
stone = mat('Warm limestone retaining terraces', (.36,.32,.26), .82)
soil = mat('Dark planting soil', (.055,.043,.027), 1)
grass = mat('Garden lawn', (.085,.135,.045), .94)
bark = mat('Date palm bark', (.19,.13,.078), .94)
leaves = [mat('Palm and fern foliage '+str(i), c, .78) for i,c in enumerate([
    (.035,.085,.025), (.07,.14,.041), (.12,.20,.066), (.17,.245,.10)])]
agave = mat('Blue-green agave', (.17,.26,.22), .76)
pot = mat('Hand-finished terracotta planters', (.32,.23,.16), .84)
water = mat('Lake water', (.028,.075,.06), .105, .48)
water.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value = .8
brass = mat('Warm brushed brass', (.49,.34,.14), .28, .8)
wood = mat('Oak dance floor', (.30,.16,.062), .38)
glass = mat('Reflective smoked clerestory glass', (.12,.20,.215), .08, .28)
gp = glass.node_tree.nodes.get('Principled BSDF')
gp.inputs['Transmission Weight'].default_value = .68
gp.inputs['IOR'].default_value = 1.46
gp.inputs['Coat Weight'].default_value = .5

# A real UV texture is baked from a procedural marble shader, so it survives glTF.
def bake_marble():
    path = TEXTURES / 'benavento-grey-marble-v2.png'
    if path.exists():
        return bpy.data.images.load(str(path), check_existing=True)
    m = bpy.data.materials.new('Marble texture authoring')
    m.use_nodes = True
    n=m.node_tree.nodes; l=m.node_tree.links; n.clear()
    tex=n.new('ShaderNodeTexCoord')
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=3.4;noise.inputs['Detail'].default_value=6
    l.new(tex.outputs['UV'],noise.inputs['Vector'])
    warp=n.new('ShaderNodeVectorMath');warp.operation='SCALE';warp.inputs[3].default_value=.43
    l.new(noise.outputs['Color'],warp.inputs[0])
    add=n.new('ShaderNodeVectorMath');add.operation='ADD'
    l.new(tex.outputs['UV'],add.inputs[0]);l.new(warp.outputs['Vector'],add.inputs[1])
    vein=n.new('ShaderNodeTexVoronoi');vein.feature='DISTANCE_TO_EDGE';vein.inputs['Scale'].default_value=2.1
    l.new(add.outputs['Vector'],vein.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position=.0006;ramp.color_ramp.elements[0].color=(.25,.265,.25,1)
    ramp.color_ramp.elements[1].position=.007;ramp.color_ramp.elements[1].color=(.115,.13,.125,1)
    l.new(vein.outputs['Distance'],ramp.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.5
    l.new(ramp.outputs[0],mix.inputs[1]);l.new(noise.outputs['Fac'],mix.inputs[2])
    emission=n.new('ShaderNodeEmission');l.new(mix.outputs[0],emission.inputs[0])
    output=n.new('ShaderNodeOutputMaterial');l.new(emission.outputs[0],output.inputs['Surface'])
    image=bpy.data.images.new('Benavento grey marble',width=1024,height=1024)
    target=n.new('ShaderNodeTexImage');target.image=image;n.active=target
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0,0,-100))
    plane=bpy.context.object;plane.data.materials.append(m)
    scene.render.engine='CYCLES';scene.cycles.samples=1
    bpy.ops.object.bake(type='EMIT')
    image.filepath_raw=str(path);image.file_format='PNG';image.save()
    bpy.data.objects.remove(plane,do_unlink=True)
    return image

marble_image = bake_marble()
marble=mat('Polished grey marble',(.12,.13,.12),.19,.025)
n=marble.node_tree.nodes;l=marble.node_tree.links
tex=n.new('ShaderNodeTexImage');tex.image=marble_image
l.new(tex.outputs['Color'],n.get('Principled BSDF').inputs['Base Color'])
n.get('Principled BSDF').inputs['Coat Weight'].default_value=.3

class Batch:
    def __init__(self,name,material,parent=shell):
        self.name=name;self.material=material;self.parent=parent;self.v=[];self.f=[];self.uv=[]
    def face(self,pts,uv=None):
        start=len(self.v);self.v.extend(pts);self.f.append(tuple(range(start,start+len(pts))))
        self.uv.extend(uv or [(p[0]/3,p[1]/3) for p in pts])
    def box(self,c,s):
        x,y,z=c;a,b,d=[v/2 for v in s]
        v=[(x+sx*a,y+sy*b,z+sz*d) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        for f in [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]:self.face([v[i] for i in f])
    def rod(self,a,b,r,r2=None,steps=8):
        a=Vector(a);b=Vector(b);axis=(b-a).normalized();ref=Vector((0,0,1))
        if abs(axis.dot(ref))>.95:ref=Vector((1,0,0))
        u=axis.cross(ref).normalized();v=axis.cross(u).normalized();r2=r if r2 is None else r2
        ring=lambda center,r:[tuple(center+r*(u*math.cos(i*math.tau/steps)+v*math.sin(i*math.tau/steps))) for i in range(steps)]
        aa=ring(a,r);bb=ring(b,r2)
        self.face(list(reversed(aa)));self.face(bb)
        for i in range(steps):j=(i+1)%steps;self.face([aa[i],aa[j],bb[j],bb[i]])
    def blade(self,a,b,width,lift=.015):
        a=Vector(a);b=Vector(b);delta=b-a;side=delta.cross(Vector((0,0,1)))
        if side.length<.001:side=Vector((1,0,0))
        side.normalize();mid=a+delta*.43;ridge=mid+Vector((0,0,lift))
        self.face([tuple(a),tuple(mid+side*width),tuple(ridge)])
        self.face([tuple(mid+side*width),tuple(b),tuple(ridge)])
        self.face([tuple(b),tuple(mid-side*width),tuple(ridge)])
        self.face([tuple(mid-side*width),tuple(a),tuple(ridge)])
    def finish(self,bevel=0):
        mesh=bpy.data.meshes.new(self.name);mesh.from_pydata(self.v,[],self.f);mesh.update()
        uv=mesh.uv_layers.new(name='UVMap')
        for loop in mesh.loops:uv.data[loop.index].uv=self.uv[loop.vertex_index]
        obj=bpy.data.objects.new(self.name,mesh);scene.collection.objects.link(obj);obj.parent=self.parent;mesh.materials.append(self.material)
        if bevel:
            mod=obj.modifiers.new('Soft manufactured edges','BEVEL');mod.width=bevel;mod.segments=2
        return obj

# Published extent and photo-estimated support positions.
floor=Batch('Grey marble slab floor',marble)
for i in range(56):
    for j in range(19):
        x=-13.75+i*.5;low=-14+j*1.5;high=min(low+1.5,14)
        floor.box((x,(low+high)/2,.008),(.494,high-low-.006,.016))
floor.finish()
base=Batch('Terrace foundation and landscape stonework',stone)
base.box((0,0,-.17),(28,.0+28,.3))
metal=Batch('Columns and perimeter I-sections',steel)
def ibeam(x,y,z,h):
    metal.box((x,y,z+h/2),(.36,.025,h))
    for side in [-1,1]:metal.box((x,y+side*.17,z+h/2),(.36,.024,h))
for x in [-11.8,11.8]:
    for y in [-11.8,11.8]:
        ibeam(x,y,0,8)
        metal.box((x,y,.037),(.6,.6,.065))
        for dx in [-.23,.23]:
            for dy in [-.23,.23]:metal.rod((x+dx,y+dy,.06),(x+dx,y+dy,.11),.025,steps=6)
for z in [3.7,7.96]:
    for edge in [-14,14]:
        metal.box((0,edge,z),(28.1,.2,.28))
        metal.box((edge,0,z),(.2,28.1,.28))
# Glass has real panel joints, a reflective coating, and visible fixing caps.
glazing=Batch('Smoked glass panels',glass)
for i in range(14):
    p=-13+i*2
    for e in [-14,14]:
        glazing.box((p,e,5.85),(1.988,.016,4.0))
        glazing.box((e,p,5.85),(.016,1.988,4.0))
        metal.box((p+1,e,5.85),(.032,.065,4.1))
        metal.box((e,p+1,5.85),(.065,.032,4.1))
glazing.finish();metal.finish(.006)
# Double-layer space frame, alternating diagonals in both directions.
truss=Batch('Double-layer steel space frame',steel,roof)
for p in range(-14,15,2):
    truss.box((0,p,7.88),(28,.08,.14));truss.box((p,0,7.88),(.08,28,.14))
for p in range(-12,13,4):
    for z in [7.10,7.82]:
        truss.box((0,p,z),(28,.1,.1));truss.box((p,0,z),(.1,28,.1))
    for j in range(14):
        x=-14+j*2;za,zb=(7.1,7.82) if j%2 else (7.82,7.1)
        truss.rod((x,p,za),(x+2,p,zb),.04)
        truss.rod((p,x,za),(p,x+2,zb),.04)
roofskin=Batch('Roof skin',steel,roof);roofskin.box((0,0,8.06),(28.15,28.15,.1));roofskin.finish()
truss.finish(.004)
# Independent suggested dance floor retains the app's current warning footprint.
dance=Batch('Suggested oak dance floor',wood)
for x in range(36):
    for y in range(8):dance.box((-4.375+x*.25,-1.75+y*.5,.04),(.247,.497,.038))
dance.finish()
# Garden context: dense planting beds flank the pavilion, leaving the four approaches open.
land=Batch('Lawn and planting beds',grass);land.box((0,0,-.55),(76,70,.2));land.finish()
beds=Batch('Planting bed soil',soil)
for x in [-17,17]:beds.box((x,0,-.13),(5,31,.25))
for y in [-17,17]:
    for x in [-9,9]:beds.box((x,y,-.13),(12,4,.25))
beds.finish()
# Stone terraces descending toward the lake (landscape heights inferred from photos).
for step in range(4):
    y=-18.5-step*1.35;z=-.3-step*.33
    base.box((0,y,z-.2),(35,1.38,.4))
base.box((0,-24.1,-1.42),(39,.45,.5))
base.finish(.02)
watermesh=Batch('Rippled lake surface',water)
for i in range(100):
    for j in range(22):
        def wp(a,b):
            x=-30+a*.6;y=-24.4-b*.6
            return (x,y,-1.6+.018*math.sin(x*3+y*4)+.009*math.sin(x*9-y*2))
        watermesh.face([wp(i,j),wp(i,j+1),wp(i+1,j+1),wp(i+1,j)])
watermesh.finish()
trunks=Batch('Date palms bark',bark)
foliage=[Batch('Palm and fern foliage '+str(i),m) for i,m in enumerate(leaves)]
def palm(x,y,h,phase):
    trunks.rod((x,y,-.15),(x+.12,y,h),.31,.21,12)
    for j in range(int(h/.16)):
        z=j*.16
        for i in range(8):
            a=i*math.tau/8+(j%2)*.3;r=.29-.08*z/h
            trunks.blade((x+r*math.cos(a),y+r*math.sin(a),z),(x+(r+.07)*math.cos(a),y+(r+.07)*math.sin(a),z+.21),.085,.025)
    for k in range(20):
        angle=phase+k*math.tau/12;length=rng.uniform(2.9,4.3);tilt=.45 if k>=12 else 0
        direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        def path(t):return Vector((x+.12,y,h-.15))+direction*(t*length)+Vector((0,0,math.sin(t*math.pi)*1.25-t*t*1.45+tilt*t))
        for j in range(12):trunks.rod(path(j/12),path((j+1)/12),.023*(1-j/15),steps=5)
        for j in range(1,24):
            t=j/25;start=path(t);leaflength=math.sin(t*math.pi)**.65*.8
            for sign in [-1,1]:
                end=start+side*sign*leaflength+direction*.22+Vector((0,0,-.22))
                foliage[k%4].blade(start,end,.045,.018)
for x in [-17.4,17.4]:
    for y in [-12,-4,4,12]:palm(x+rng.uniform(-.3,.3),y,rng.uniform(6.6,8.6),rng.random()*6)
# Fine fern fronds, with individually folded leaflets.
for i in range(180):
    side=-1 if i%2 else 1;x=side*rng.uniform(14.6,19);y=rng.uniform(-15,15)
    for f in range(7):
        a=rng.random()*math.tau;length=rng.uniform(.5,1.1);d=Vector((math.cos(a),math.sin(a),0));s=Vector((-math.sin(a),math.cos(a),0))
        for j in range(1,9):
            t=j/10;center=Vector((x,y,0))+d*t*length+Vector((0,0,.15+math.sin(t*math.pi)*.5))
            for sign in [-1,1]:foliage[(i+f)%4].blade(center,center+s*sign*(1-t)*.23+d*.11+Vector((0,0,-.06)),.034)
# Dense, irregular shrub volumes with individually folded outer leaves.
for i in range(100):
    x=(-1 if i%2 else 1)*rng.uniform(15.2,19.3);y=rng.uniform(-16,16)
    h=rng.uniform(.65,1.35);radius=rng.uniform(.5,.95)
    for j in range(65):
        az=rng.random()*math.tau;el=rng.uniform(-.3,1.5)
        pos=Vector((x+radius*math.cos(el)*math.cos(az),y+radius*math.cos(el)*math.sin(az),h*.5+h*.55*math.sin(el)))
        end=pos+Vector((math.cos(az)*.24,math.sin(az)*.24,.08))
        foliage[i%4].blade(pos,end,.09,.025)
# Taller tree canopies sit outside the planning footprint, like the reference garden.
for i in range(26):
    a=i*math.tau/26;x=math.cos(a)*rng.uniform(25,31);y=math.sin(a)*rng.uniform(24,29);h=rng.uniform(5.5,10)
    trunks.rod((x,y,-.4),(x+.3,y,h-1),.18,.075,9)
    for cluster in range(7):
        cx=x+rng.uniform(-1.9,1.9);cy=y+rng.uniform(-1.9,1.9);cz=h+rng.uniform(-1.5,1)
        for j in range(100):
            az=rng.random()*math.tau;el=rng.uniform(-1.3,1.3);radius=rng.uniform(.7,1.5)
            pos=Vector((cx+radius*math.cos(el)*math.cos(az),cy+radius*math.cos(el)*math.sin(az),cz+radius*math.sin(el)))
            foliage[(i+cluster)%4].blade(pos,pos+Vector((math.cos(az)*.35,math.sin(az)*.35,.06)),.11,.035)
trunks.finish()
for b in foliage:b.finish()
planters=Batch('Terracotta agave pots',pot);agaves=Batch('Sculptural agave leaves',agave)
for step in range(4):
    for i in range(9):
        x=-15+i*3.7+(step%2)*.4;y=-18.4-step*1.35;z=-.1-step*.33
        planters.rod((x,y,z),(x,y,z+.52),.21,.34,16)
        planters.rod((x,y,z+.5),(x,y,z+.56),.35,.35,16)
        for j in range(16):
            a=j*math.tau/10;r=.65 if j<10 else .34;h=.5 if j<10 else .9
            agaves.blade((x,y,z+.54),(x+math.cos(a)*r,y+math.sin(a)*r,z+.54+h),.07,.03)
planters.finish();agaves.finish()
# Render lighting, fully separate from the web shell.
world=bpy.data.worlds.new('Garden sunset HDRI');world.use_nodes=True;scene.world=world
n=world.node_tree.nodes;l=world.node_tree.links
hdri=n.new('ShaderNodeTexEnvironment');hdri.image=bpy.data.images.load(str(TEXTURES/'rosendal_park_sunset_1k.hdr'),check_existing=True)
l.new(hdri.outputs['Color'],n.get('Background').inputs['Color']);n.get('Background').inputs['Strength'].default_value=.65
sun_data=bpy.data.lights.new('Late afternoon sun','SUN');sun_data.energy=2.2;sun_data.angle=.12;sun_data.color=(1,.83,.63)
sun=bpy.data.objects.new('Late afternoon sun',sun_data);scene.collection.objects.link(sun);sun.rotation_euler=(math.radians(34),math.radians(-22),math.radians(-35))
# Restore physically plausible glass and fabrics on the imported furniture.
for m in bpy.data.materials:
    if not m.use_nodes:continue
    p=m.node_tree.nodes.get('Principled BSDF')
    if not p:continue
    if m.name.startswith('Stemware'):
        p.inputs['Alpha'].default_value=1;p.inputs['Transmission Weight'].default_value=1;p.inputs['Roughness'].default_value=.055;p.inputs['IOR'].default_value=1.46
    if m.name.startswith('Draped ivory linen'):
        p.inputs['Sheen Weight'].default_value=.6
        noise=m.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=210;noise.inputs['Detail'].default_value=2
        bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.13;bump.inputs['Distance'].default_value=.012
        m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs[0],p.inputs['Normal'])

def camera(name,pos,target,lens):
    data=bpy.data.cameras.new(name);data.lens=lens;data.clip_end=300
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler();return obj
scene.camera=camera('Reception interior',(10,-11,1.8),(-2,6,2.8),20)
camera('Garden facade',(27,-37,6),(0,0,3.2),34)
camera('Planning overview',(32,-38,30),(0,0,1),40)
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=.6
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUTPUT/'benavento-terrace-interior.png')
# Preserve a useful camera view when the .blend is opened.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.overlay.show_overlays=False
# Export shell only; sample table metadata stays in the authoring file, app owns interaction.
bpy.ops.object.select_all(action='DESELECT')
for obj in [shell]+list(shell.children_recursive):obj.select_set(True)
with redirect_stdout(io.StringIO()):
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/venue/benavento-terrace-detailed.glb'),export_format='GLB',export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_draco_position_quantization=16,use_selection=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/'benavento-terrace.blend'))
print(json.dumps({'scene':scene.name,'objects':len(scene.objects),'tables':len([o for o in scene.objects if o.get('tableId')]),'shell_meshes':len([o for o in shell.children_recursive if o.type=='MESH']),'blend':str(OUTPUT/'benavento-terrace.blend'),'shell_glb':str(ROOT/'public/venue/benavento-terrace-detailed.glb')}))
