import {ipcRenderer} from '../platform/rendererBridge';
import './canvasBrowser.css';
type BrowserTab={id:string;title:string;url:string;loading:boolean;canGoBack:boolean;canGoForward:boolean};
type Snapshot={activeId:string|null;tabs:BrowserTab[]};
export function installCanvasBrowser(actions:{open():void;document():void}){
 const sidebar=document.getElementById('canvas-sidebar')!,header=document.getElementById('canvas-header')!;
 const switcher=document.createElement('div');switcher.className='canvas-surface-switch';
 const docButton=document.createElement('button'),browserButton=document.createElement('button');docButton.textContent='Document';browserButton.textContent='Browser';docButton.type=browserButton.type='button';switcher.append(docButton,browserButton);header.append(switcher);
 const panel=document.createElement('section');panel.className='canvas-browser';panel.hidden=true;panel.setAttribute('aria-label','Orion Browser');
 panel.innerHTML='<nav class="canvas-browser-tabs" aria-label="Browser tabs"></nav><div class="canvas-browser-navigation"><button type="button" data-action="back" title="Back" aria-label="Back">←</button><button type="button" data-action="forward" title="Forward" aria-label="Forward">→</button><button type="button" data-action="reload" title="Reload" aria-label="Reload">↻</button><form><input type="text" aria-label="Search or enter address" placeholder="Search or enter address" spellcheck="false" autocomplete="off"><button type="submit" title="Go" aria-label="Go">↵</button></form><button type="button" data-action="new" title="New tab" aria-label="New tab">＋</button></div><div class="canvas-browser-status" role="status"></div><div class="canvas-browser-viewport"><div class="canvas-browser-empty">Open a website or ask the AI to browse.</div></div>';
 sidebar.append(panel);
 const tabs=panel.querySelector('nav')!,address=panel.querySelector('input')!,status=panel.querySelector('.canvas-browser-status')!,viewport=panel.querySelector('.canvas-browser-viewport')!;
 let browserMode=false,state:Snapshot={activeId:null,tabs:[]},frame=0,lastBounds='';
 const reportError=(error:unknown)=>{status.textContent=String(error);};
 const invoke=(channel:string,...args:unknown[])=>ipcRenderer.invoke(channel,...args).catch(reportError);
 function layout(){frame=0;const rect=viewport.getBoundingClientRect();const visible=browserMode&&!sidebar.hidden&&!document.hidden&&state.tabs.length>0&&!document.querySelector('dialog[open]')&&rect.width>10&&rect.height>10;const bounds={x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible};const signature=JSON.stringify(bounds);if(signature!==lastBounds){lastBounds=signature;void invoke('browser:bounds',bounds);}}
 function schedule(){if(!frame)frame=requestAnimationFrame(layout);}
 function mode(browser:boolean){browserMode=browser;panel.hidden=!browser;sidebar.classList.toggle('canvas-browser-active',browser);docButton.classList.toggle('active',!browser);browserButton.classList.toggle('active',browser);docButton.setAttribute('aria-pressed',String(!browser));browserButton.setAttribute('aria-pressed',String(browser));if(browser){document.getElementById('canvas-name')!.textContent='Orion Browser';}else{document.getElementById('canvas-body')!.hidden=false;actions.document();}schedule();}
 function render(value:Snapshot){state=value;tabs.replaceChildren();for(const tab of state.tabs){const item=document.createElement('div');item.className='canvas-browser-tab'+(tab.id===state.activeId?' active':'');const focus=document.createElement('button');focus.type='button';focus.textContent=tab.title||'New tab';focus.title=tab.url;focus.onclick=()=>void invoke('browser:focus',tab.id);const close=document.createElement('button');close.type='button';close.className='canvas-browser-tab-close';close.textContent='×';close.setAttribute('aria-label','Close '+tab.title);close.onclick=()=>void invoke('browser:close',tab.id);item.append(focus,close);tabs.append(item);}const active=state.tabs.find(tab=>tab.id===state.activeId);if(document.activeElement!==address)address.value=active?.url??'';for(const action of ['back','forward']){const button=panel.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;button.disabled=action==='back'?!active?.canGoBack:!active?.canGoForward;}const reload=panel.querySelector('[data-action="reload"]')!;reload.textContent=active?.loading?'×':'↻';status.textContent=active?.loading?'Loading…':active?.url??'Private browser · HTTPS';panel.querySelector('.canvas-browser-empty')!.toggleAttribute('hidden',Boolean(active));schedule();}
 docButton.onclick=()=>mode(false);browserButton.onclick=()=>{actions.open();mode(true);};
 panel.querySelector('form')!.onsubmit=e=>{e.preventDefault();if(address.value.trim())void invoke('browser:navigate',address.value);};
 panel.querySelector('[data-action="new"]')!.addEventListener('click',()=>void invoke('browser:create'));
 for(const action of ['back','forward','reload'])panel.querySelector(`[data-action="${action}"]`)!.addEventListener('click',()=>void invoke('browser:action',action==='reload'&&state.tabs.find(tab=>tab.id===state.activeId)?.loading?'stop':action));
 ipcRenderer.on('browser:state',(_event,value:Snapshot)=>render(value));
 ipcRenderer.on('browser:show',()=>{actions.open();mode(true);});
 function shortcut(action:string){if(!browserMode||sidebar.hidden)return;if(action==='address'){address.focus();address.select();}else if(action==='new')void invoke('browser:create');else if(action==='close'&&state.activeId)void invoke('browser:close',state.activeId);else if(action==='next'||action==='previous'){const index=state.tabs.findIndex(tab=>tab.id===state.activeId),tab=state.tabs[(index+(action==='next'?1:-1)+state.tabs.length)%state.tabs.length];if(tab)void invoke('browser:focus',tab.id);}}
 ipcRenderer.on('browser:shortcut',(_event,action:string)=>shortcut(action));
 document.addEventListener('keydown',event=>{if(!browserMode||sidebar.hidden||!sidebar.contains(document.activeElement)||!(event.ctrlKey||event.metaKey))return;const key=event.key.toLowerCase(),action=key==='l'?'address':key==='t'?'new':key==='w'?'close':event.key==='Tab'?(event.shiftKey?'previous':'next'):'';if(action){event.preventDefault();shortcut(action);}});
 new ResizeObserver(schedule).observe(viewport);
 new MutationObserver(schedule).observe(document.body,{attributes:true,subtree:true,attributeFilter:['hidden','open','class','style']});
 document.addEventListener('visibilitychange',schedule);window.addEventListener('resize',schedule);
 void invoke('browser:state').then(value=>{if(value)render(value as Snapshot);});
 mode(false);
 return {showDocument:()=>mode(false),layout:schedule};
}
