import './welcomeArt.css';

let disposeCurrent: (() => void) | undefined;
const vertexSource = `
precision highp float;
attribute vec2 uv;
uniform float time;
uniform float aspect;
varying vec3 position;
varying vec3 normal;
const float TAU = 6.28318530718;
vec3 surface(vec2 st) {
  float u = st.x * TAU, v = st.y * TAU;
  // Both the centerline and cross-section deform; this is live geometry.
  float sweep = 0.88 + 0.12*sin(3.0*u-time*0.62) + 0.08*cos(2.0*u+time*0.43);
  float thickness = 0.27 + 0.075*sin(3.0*u+time*0.88) + 0.035*cos(5.0*u-time*0.38);
  float twist = 0.7*sin(2.0*u-time*0.48) + 0.22*cos(time*0.31);
  float a = v + twist;
  float fold = thickness * (1.0 + 0.14*cos(3.0*v+u-time*0.55));
  vec3 p = vec3((sweep+fold*cos(a))*cos(u), (sweep+fold*cos(a))*sin(u), fold*sin(a));
  p.z += 0.29*sin(2.0*u+time*0.57) + 0.10*cos(3.0*u-time*0.39);
  p.x *= 1.07;
  p.y *= 0.91 + 0.055*sin(time*0.44);
  // Fixed camera orientation keeps the object grounded while its material flows.
  float ax=0.78, az=-0.41;
  p.yz = mat2(cos(ax),-sin(ax),sin(ax),cos(ax))*p.yz;
  p.xy = mat2(cos(az),-sin(az),sin(az),cos(az))*p.xy;
  return p;
}
void main() {
  vec3 p = surface(uv);
  vec3 du = surface(uv+vec2(0.0004,0.0))-surface(uv-vec2(0.0004,0.0));
  vec3 dv = surface(uv+vec2(0.0,0.0004))-surface(uv-vec2(0.0,0.0004));
  position=p; normal=normalize(cross(du,dv));
  float depth=4.2-p.z;
  gl_Position=vec4(p.x*2.9/aspect,p.y*2.9,depth*1.01005-0.201005,depth);
}`;
const fragmentSource = `
precision highp float;
varying vec3 position;
varying vec3 normal;
float softbox(vec3 reflection, vec3 direction, float tightness) {
  return pow(max(0.0,dot(reflection,normalize(direction))),tightness);
}
void main() {
  vec3 n=normalize(normal);
  if(!gl_FrontFacing)n=-n;
  vec3 view=normalize(vec3(0.0,0.0,4.2)-position);
  vec3 reflected=reflect(-view,n);
  float facing=max(0.0,dot(n,view));
  float fresnel=0.2+0.8*pow(1.0-facing,4.0);
  // A dark studio environment with long softbox reflections, no background plane.
  float top=softbox(reflected,vec3(-0.6,1.0,0.7),18.0);
  float side=softbox(reflected,vec3(1.0,0.25,0.9),34.0);
  float edge=softbox(reflected,vec3(-1.0,-0.25,0.15),16.0);
  float ribbon=exp(-pow((reflected.y-0.52)*15.0,2.0))*smoothstep(-0.65,0.55,reflected.z);
  float soft=pow(max(0.0,dot(n,normalize(vec3(-0.3,0.8,1.0)))),1.5);
  vec3 color=vec3(0.018,0.019,0.024)+soft*vec3(0.045,0.047,0.056);
  color+=(top*0.72+side*0.55+edge*0.30+ribbon*0.27)*mix(vec3(0.69,0.71,0.79),vec3(0.98),fresnel);
  color+=vec3(0.10,0.10,0.13)*pow(1.0-facing,3.0);
  color*=0.78+0.22*smoothstep(-0.55,0.55,position.z);
  color=pow(color,vec3(0.83));
  gl_FragColor=vec4(color,1.0);
}`;

function gpuRenderer(canvas: HTMLCanvasElement): { draw(time: number): void; dispose(): void } | undefined {
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'low-power'});
  if(!gl)return;
  const shaders: WebGLShader[]=[];
  const compile=(type:number,source:string)=>{
    const shader=gl.createShader(type);if(!shader)throw new Error('Shader unavailable');
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw new Error('Shader compilation failed');}
    shaders.push(shader);return shader;
  };
  let program: WebGLProgram|null=null, vertices: WebGLBuffer|null=null, elements: WebGLBuffer|null=null;
  try {
    program=gl.createProgram();if(!program)throw new Error('Program unavailable');
    gl.attachShader(program,compile(gl.VERTEX_SHADER,vertexSource));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragmentSource));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Shader link failed');
    const around=144,section=48,uv:number[]=[],indices:number[]=[];
    for(let u=0;u<=around;u++)for(let v=0;v<=section;v++)uv.push(u/around,v/section);
    for(let u=0;u<around;u++)for(let v=0;v<section;v++){
      const a=u*(section+1)+v,b=a+section+1;indices.push(a,b,a+1,a+1,b,b+1);
    }
    vertices=gl.createBuffer();elements=gl.createBuffer();
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'uv');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
    const timeLocation=gl.getUniformLocation(program,'time'),aspect=gl.getUniformLocation(program,'aspect');
    return {
      draw(time){gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1f(timeLocation,time);gl.uniform1f(aspect,canvas.width/canvas.height);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);},
      dispose(){gl.deleteBuffer(vertices);gl.deleteBuffer(elements);gl.deleteProgram(program);shaders.forEach(shader=>gl.deleteShader(shader));gl.getExtension('WEBGL_lose_context')?.loseContext();}
    };
  }catch{
    gl.deleteBuffer(vertices);gl.deleteBuffer(elements);gl.deleteProgram(program);shaders.forEach(shader=>gl.deleteShader(shader));gl.getExtension('WEBGL_lose_context')?.loseContext();return;
  }
}

/** The official icon is a frozen frame of the same geometry and lighting. */
export function captureLiquidMetalStill(size = 2048, time = 1.8): string {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const renderer = gpuRenderer(canvas);
  if (!renderer) throw new Error('WebGL is required to render the official liquid-metal icon.');
  try {
    renderer.draw(time);
    const output = document.createElement('canvas'); output.width = size; output.height = size;
    const context = output.getContext('2d');
    if (!context) throw new Error('Could not prepare transparent icon output.');
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, size, size).data;
    let left = size, top = size, right = -1, bottom = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (pixels[(y * size + x) * 4 + 3]! > 2) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) throw new Error('The liquid-metal render is empty.');
    const width = right - left + 1, height = bottom - top + 1, scale = size * .98 / Math.max(width, height);
    context.clearRect(0, 0, size, size);
    context.drawImage(canvas, left, top, width, height, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
    return output.toDataURL('image/png');
  }
  finally { renderer.dispose(); }
}

/** An actual deforming surface, rather than an image moved by CSS. */
export function createWelcomeArt() {
  disposeCurrent?.();
  const empty=document.createElement('div');empty.className='empty-state orion-idle';
  const art=document.createElement('div');art.className='orion-idle-art';
  let canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label','An evolving liquid-metal form, rendered live');
  const greeting=document.createElement('p');greeting.className='orion-idle-greeting';greeting.textContent='Hello, welcome to Orion.';
  art.append(canvas);empty.append(art,greeting);
  let renderer=gpuRenderer(canvas);
  const accelerated=Boolean(renderer);
  if(!renderer){
    // Canvas contexts cannot change kind; use a fresh surface for the CPU fallback.
    const fallback=document.createElement('canvas');fallback.setAttribute('role','img');fallback.setAttribute('aria-label',canvas.getAttribute('aria-label')!);canvas.replaceWith(fallback);canvas=fallback;
    const ctx=canvas.getContext('2d');
    if(ctx)renderer={draw(time){
      ctx.clearRect(0,0,canvas.width,canvas.height);const cx=canvas.width/2,cy=canvas.height/2,scale=canvas.width*.28;
      for(let layer=0;layer<34;layer++){
        const depth=layer/33,gradient=ctx.createLinearGradient(cx-scale,cy-scale,cx+scale,cy+scale);
        gradient.addColorStop(0,'#72727d');gradient.addColorStop(.25,'#101014');gradient.addColorStop(.65,'#454550');gradient.addColorStop(1,'#101014');
        ctx.beginPath();
        for(let i=0;i<=160;i++){const angle=i/160*Math.PI*2,r=1+.15*Math.sin(3*angle+time*.7)+.08*Math.cos(5*angle-time*.4),tube=.28*Math.cos(depth*Math.PI*2),x=cx+Math.cos(angle)*(r+tube)*scale,y=cy+Math.sin(angle)*(r+tube)*scale*.76+Math.sin(2*angle+time*.5)*scale*.15; if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
        ctx.strokeStyle=gradient;ctx.lineWidth=Math.max(1,canvas.width/280);ctx.stroke();
      }
    },dispose(){ctx.clearRect(0,0,canvas.width,canvas.height);}};
  }
  if(!renderer)return empty;
  const surface=renderer,reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,previous=0,elapsed=0,visible=true,disposed=false,drawn=false;
  canvas.dataset.renderer=accelerated?'webgl':'canvas';
  let removal:MutationObserver|undefined;
  const resize=()=>{const rect=art.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.75);canvas.width=Math.max(1,Math.min(760,Math.round(rect.width*ratio)));canvas.height=Math.max(1,Math.min(760,Math.round(rect.height*ratio)));if(canvas.width>1){surface.draw(elapsed);drawn=true;}};
  const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();removal?.disconnect();document.removeEventListener('visibilitychange',resume);reduce.removeEventListener('change',resume);surface.dispose();if(disposeCurrent===dispose)disposeCurrent=undefined;};
  const tick=(now:number)=>{
    frame=0;if(disposed)return;if(!empty.isConnected){dispose();return;}
    if(document.hidden||!visible){previous=0;return;}
    if(!drawn)resize();
    if(now-previous>=1000/30){if(previous)elapsed+=Math.min(.08,(now-previous)/1000);previous=now;surface.draw(elapsed);canvas.dataset.frame=String(Math.round(elapsed*30));}
    if(!reduce.matches)frame=requestAnimationFrame(tick);
  };
  const resume=()=>{if(!disposed&&!document.hidden&&visible&&!frame){previous=0;frame=requestAnimationFrame(tick);}};
  const observer=new ResizeObserver(resize);observer.observe(art);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;if(visible)resume();});intersection.observe(art);
  document.addEventListener('visibilitychange',resume);reduce.addEventListener('change',resume);
  // Release the GPU even if a conversation replaces the empty view while paused.
  removal=new MutationObserver(()=>{if(!empty.isConnected&&drawn)dispose();});removal.observe(document.getElementById('messages')??document.body,{childList:true});
  disposeCurrent=dispose;
  resume();return empty;
}
