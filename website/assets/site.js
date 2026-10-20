var A,W=`
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
}`,O=`
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
}`;function D(d){let e=d.getContext("webgl",{alpha:!0,antialias:!0,premultipliedAlpha:!1,powerPreference:"low-power"});if(!e)return;let p=[],t=(a,c)=>{let r=e.createShader(a);if(!r)throw Error("Shader unavailable");if(e.shaderSource(r,c),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS))throw e.deleteShader(r),Error("Shader compilation failed");return p.push(r),r},i=null,o=null,x=null;try{if(i=e.createProgram(),!i)throw Error("Program unavailable");if(e.attachShader(i,t(e.VERTEX_SHADER,W)),e.attachShader(i,t(e.FRAGMENT_SHADER,O)),e.linkProgram(i),!e.getProgramParameter(i,e.LINK_STATUS))throw Error("Shader link failed");let a=144,c=48,r=[],m=[];for(let n=0;n<=a;n++)for(let g=0;g<=c;g++)r.push(n/a,g/c);for(let n=0;n<a;n++)for(let g=0;g<c;g++){let u=n*(c+1)+g,f=u+c+1;m.push(u,f,u+1,u+1,f,f+1)}o=e.createBuffer(),x=e.createBuffer(),e.useProgram(i),e.bindBuffer(e.ARRAY_BUFFER,o),e.bufferData(e.ARRAY_BUFFER,new Float32Array(r),e.STATIC_DRAW);let h=e.getAttribLocation(i,"uv");e.enableVertexAttribArray(h),e.vertexAttribPointer(h,2,e.FLOAT,!1,0,0),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,x),e.bufferData(e.ELEMENT_ARRAY_BUFFER,new Uint16Array(m),e.STATIC_DRAW),e.enable(e.DEPTH_TEST),e.disable(e.CULL_FACE),e.clearColor(0,0,0,0);let v=e.getUniformLocation(i,"time"),w=e.getUniformLocation(i,"aspect");return{draw(n){e.viewport(0,0,d.width,d.height),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),e.uniform1f(v,n),e.uniform1f(w,d.width/d.height),e.drawElements(e.TRIANGLES,m.length,e.UNSIGNED_SHORT,0)},dispose(){e.deleteBuffer(o),e.deleteBuffer(x),e.deleteProgram(i),p.forEach((n)=>e.deleteShader(n)),e.getExtension("WEBGL_lose_context")?.loseContext()}}}catch{e.deleteBuffer(o),e.deleteBuffer(x),e.deleteProgram(i),p.forEach((a)=>e.deleteShader(a)),e.getExtension("WEBGL_lose_context")?.loseContext();return}}function P(d=!1){A?.();let e=document.createElement("div");e.className=d?"orion-loading-art":"empty-state orion-idle";let p=document.createElement("div");p.className="orion-idle-art";let t=document.createElement("canvas");t.setAttribute("role","img"),t.setAttribute("aria-label","An evolving liquid-metal form, rendered live");let i=document.createElement("p");i.className="orion-idle-greeting",i.textContent=d?"Waiting for model":"Hello, welcome to Orion.",p.append(t),e.append(p,i);let o=D(t),x=Boolean(o);if(!o){let l=document.createElement("canvas");l.setAttribute("role","img"),l.setAttribute("aria-label",t.getAttribute("aria-label")),t.replaceWith(l),t=l;let s=t.getContext("2d");if(s)o={draw(_){s.clearRect(0,0,t.width,t.height);let S=t.width/2,R=t.height/2,b=t.width*0.28;for(let M=0;M<34;M++){let U=M/33,z=s.createLinearGradient(S-b,R-b,S+b,R+b);z.addColorStop(0,"#72727d"),z.addColorStop(0.25,"#101014"),z.addColorStop(0.65,"#454550"),z.addColorStop(1,"#101014"),s.beginPath();for(let E=0;E<=160;E++){let k=E/160*Math.PI*2,B=1+0.15*Math.sin(3*k+_*0.7)+0.08*Math.cos(5*k-_*0.4),F=0.28*Math.cos(U*Math.PI*2),j=S+Math.cos(k)*(B+F)*b,I=R+Math.sin(k)*(B+F)*b*0.76+Math.sin(2*k+_*0.5)*b*0.15;if(E===0)s.moveTo(j,I);else s.lineTo(j,I)}s.strokeStyle=z,s.lineWidth=Math.max(1,t.width/280),s.stroke()}},dispose(){s.clearRect(0,0,t.width,t.height)}}}if(!o)return e;let a=o,c=matchMedia("(prefers-reduced-motion: reduce)"),r=0,m=0,h=0,v=!0,w=!1,n=!1;t.dataset.renderer=x?"webgl":"canvas";let g,u=()=>{let l=p.getBoundingClientRect(),s=Math.min(devicePixelRatio||1,1.75);if(t.width=Math.max(1,Math.min(760,Math.round(l.width*s))),t.height=Math.max(1,Math.min(760,Math.round(l.height*s))),t.width>1)a.draw(h),n=!0},f=()=>{if(w)return;if(w=!0,cancelAnimationFrame(r),T.disconnect(),C.disconnect(),g?.disconnect(),document.removeEventListener("visibilitychange",y),c.removeEventListener("change",y),a.dispose(),A===f)A=void 0},L=(l)=>{if(r=0,w)return;if(!e.isConnected){f();return}if(document.hidden||!v){m=0;return}if(!n)u();if(l-m>=33.333333333333336){if(m)h+=Math.min(0.08,(l-m)/1000);m=l,a.draw(h),t.dataset.frame=String(Math.round(h*30))}if(!c.matches)r=requestAnimationFrame(L)},y=()=>{if(!w&&!document.hidden&&v&&!r)m=0,r=requestAnimationFrame(L)},T=new ResizeObserver(u);T.observe(p);let C=new IntersectionObserver((l)=>{if(v=l[0]?.isIntersecting??!0,v)y()});return C.observe(p),document.addEventListener("visibilitychange",y),c.addEventListener("change",y),g=new MutationObserver(()=>{if(!e.isConnected&&n)f()}),g.observe(document.getElementById("messages")??document.body,{childList:!0,subtree:d}),A=f,y(),e}var q=document.getElementById("metal");if(q)try{q.replaceChildren(P())}catch{}var G={windows:/setup.*\.exe$/i,portable:/^Orion[. -][\d.]+\.exe$/i,appimage:/\.AppImage$/i,deb:/\.deb$/i,rpm:/\.rpm$/i};async function N(){let d=await fetch("https://api.github.com/repos/quietsource/Orion/releases/latest",{signal:AbortSignal.timeout(6000),credentials:"omit",referrerPolicy:"no-referrer"});if(!d.ok)return;let e=await d.json(),p=(i)=>{try{let o=new URL(i);return o.protocol==="https:"&&o.hostname==="github.com"&&o.pathname.startsWith("/quietsource/Orion/releases/")}catch{return!1}};for(let[i,o]of Object.entries(G)){let x=e.assets?.find((a)=>o.test(a.name));if(x&&p(x.browser_download_url))document.querySelectorAll(`[data-asset="${i}"]`).forEach((a)=>{a.href=x.browser_download_url})}let t=document.getElementById("release-version");if(t&&e.tag_name&&e.html_url&&p(e.html_url))t.textContent=e.tag_name,t.href=e.html_url}N().catch(()=>{});
