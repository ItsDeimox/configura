/* Aurora Edge Field: real GLSL ES 3.00, WebGL2 GPU layer. */
const VERTEX="#version 300 es\nprecision highp float;\nvoid main() {\n  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n}";
const FRAGMENT="#version 300 es\nprecision highp float;\nuniform vec2 u_resolution;\nuniform vec2 u_pointer;\nuniform float u_time;\nuniform float u_activity;\nout vec4 fragColor;\nfloat lineSdf(vec2 p,vec2 a,vec2 b) {\n  vec2 v=b-a,w=p-a;\n  return length(w-v*clamp(dot(w,v)/dot(v,v),0.0,1.0));\n}\nfloat node(vec2 p,vec2 a,float k){return k*exp(-length(p-a)*72.0);}\nvoid main(){\n  vec2 p=(gl_FragCoord.xy-.5*u_resolution)/min(u_resolution.x,u_resolution.y);\n  vec2 m=(u_pointer-.5*u_resolution)/min(u_resolution.x,u_resolution.y);\n  float near=exp(-pow(length(p-m)*3.2,2.0));\n  float halo=exp(-pow(length(p-m)*2.2,2.0));\n  float t=u_time;\n  // Thin lines and joints revealed by proximity to the mouse.\n  vec2 cell=abs(fract(p/.23+vec2(.11,.19))-.5)*.23;\n  float d=min(cell.x,cell.y);\n  float width=max(fwidth(d),.0008);\n  float grid=(1.0-smoothstep(0.0,width*1.2,d))*.16+exp(-d*100.0)*.08;\n  float joints=exp(-length(cell)*95.0)*.20;\n  float reveal=(grid+joints)*near;\n  // Geometric wires with moving wavefront and smooth dissipation.\n  float d1=lineSdf(p,vec2(-1.3,.31),vec2(-.66,.31));\n  float d2=lineSdf(p,vec2(-.66,.31),vec2(-.52,.17));\n  float d3=lineSdf(p,vec2(.60,-.28),vec2(1.25,-.28));\n  float d4=lineSdf(p,vec2(.51,-.13),vec2(.60,-.28));\n  float d5=lineSdf(p,vec2(-1.04,-.43),vec2(-.76,-.43));\n  float d6=lineSdf(p,vec2(.83,.46),vec2(1.18,.46));\n  float filament=exp(-min(min(min(d1,d2),min(d3,d4)),min(d5,d6))*116.0);\n  float phase=t*2.7-p.x*11.0+p.y*7.0;\n  float core=pow(max(0.0,sin(phase)),20.0);\n  float tail=pow(max(0.0,sin(phase-.65)),3.0);\n  float traces=filament*(.045+.45*core+.11*tail)*(.3+.7*halo);\n  float vertices=node(p,vec2(-.66,.31),.25)+node(p,vec2(-.52,.17),.14)\n    +node(p,vec2(.60,-.28),.25)+node(p,vec2(.51,-.13),.14)\n    +node(p,vec2(.83,.46),.16);\n  vertices*=.14+.86*halo;\n  float pulse=halo*(.019+.075*u_activity);\n  float ambient=exp(-dot(p-vec2(.0,.15),p-vec2(.0,.15))*3.2)*(.018+.008*sin(t*.3));\n  float energy=reveal+traces+vertices+pulse+ambient;\n  vec3 blue=vec3(.39,.62,1.0);\n  vec3 ice=vec3(.62,.81,1.0);\n  vec3 violet=vec3(.66,.55,1.0);\n  vec3 light=blue*(reveal+ambient)+ice*(traces+vertices)+mix(blue,violet,.42)*pulse;\n  float alpha=clamp(energy*1.35,0.0,.45);\n  fragColor=vec4(light*alpha*2.4,alpha);\n}";

const canvas = document.getElementById('energy-canvas');
const state = {
  gl:null,program:null,uniforms:null,ready:false,enabled:!document.documentElement.classList.contains('effects-off'),
  frame:0,last:0,time:0,width:0,height:0,scale:1,
  pointer:[innerWidth*.5,innerHeight*.55],target:[innerWidth*.5,innerHeight*.55],activity:0
};
function compile(gl,type,source){
  const s=gl.createShader(type);
  gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
    const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(error||'GLSL compile');
  }
  return s;
}
function resize(){
  if(!state.ready)return;
  const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);
  state.scale=Math.max(.45,Math.min(devicePixelRatio||1,1.4,Math.sqrt(1600000/(w*h))));
  const dw=Math.round(w*state.scale),dh=Math.round(h*state.scale);
  if(canvas.width!==dw||canvas.height!==dh){canvas.width=dw;canvas.height=dh}
  state.width=dw;state.height=dh;state.gl.viewport(0,0,dw,dh);
}
function init(){
  try{
    const gl=canvas?.getContext('webgl2',{
      alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,
      preserveDrawingBuffer:false,powerPreference:'high-performance',desynchronized:true
    });
    if(!gl)return false;
    const vs=compile(gl,gl.VERTEX_SHADER,VERTEX),fs=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
    const prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);
    gl.linkProgram(prog);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog)||'GLSL link');
    gl.bindVertexArray(gl.createVertexArray());gl.useProgram(prog);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);
    state.gl=gl;state.program=prog;state.uniforms={
      res:gl.getUniformLocation(prog,'u_resolution'),
      pointer:gl.getUniformLocation(prog,'u_pointer'),
      time:gl.getUniformLocation(prog,'u_time'),
      activity:gl.getUniformLocation(prog,'u_activity')
    };
    state.ready=true;resize();return true;
  }catch(err){
    console.warn('[Ini Studio] WebGL2 indisponível. Usando fallback CSS:',err.message);
    state.ready=false;if(canvas)canvas.style.display='none';return false;
  }
}
function paint(now){
  if(!state.enabled||document.hidden||!state.ready){state.frame=0;return}
  state.frame=requestAnimationFrame(paint);
  const dt=now-state.last, fps=innerWidth<650?30:45;
  if(state.last&&dt<1000/fps)return;
  state.time+=Math.min(dt||16,65)/1000;state.last=now;
  state.pointer[0]+=(state.target[0]-state.pointer[0])*.10;
  state.pointer[1]+=(state.target[1]-state.pointer[1])*.10;
  state.activity*=.945;
  const gl=state.gl,u=state.uniforms;
  gl.useProgram(state.program);
  gl.uniform2f(u.res,state.width,state.height);
  gl.uniform2f(u.pointer,state.pointer[0]*state.scale,(innerHeight-state.pointer[1])*state.scale);
  gl.uniform1f(u.time,state.time);gl.uniform1f(u.activity,state.activity);
  gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
}
function start(){if(state.frame||!state.ready||!state.enabled||document.hidden)return;state.last=0;state.frame=requestAnimationFrame(paint)}
function stop(){cancelAnimationFrame(state.frame);state.frame=0}
window.addEventListener('pointermove',e=>{
  state.target[0]=e.clientX;state.target[1]=e.clientY;
  state.activity=Math.min(1,state.activity+.13);
},{passive:true});
window.addEventListener('resize',resize,{passive:true});
document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
window.addEventListener('ini-studio:effects',e=>{
  state.enabled=Boolean(e.detail?.enabled);
  if(state.enabled)start();else {stop();if(state.gl&&state.ready)state.gl.clear(state.gl.COLOR_BUFFER_BIT)}
});
canvas?.addEventListener('webglcontextlost',e=>{e.preventDefault();stop();state.ready=false});
canvas?.addEventListener('webglcontextrestored',()=>{state.ready=false;if(init())start()});
if(init())start();
