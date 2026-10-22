import {isCodexTarget} from '../src/codex-skin.mjs';
import {makeManagerRemovalScript} from '../src/manager-renderer.mjs';
const port=Number(process.argv[2]||9222);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid loopback port.');
let targets=[];
try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(3000)})).json();}catch{process.exit(0);}
for(const target of targets.filter(isCodexTarget)){
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Connection timeout')),3000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',reject,{once:true});});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Removal timeout')),5000);socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id!==1)return;clearTimeout(timer);message.error?reject(new Error(message.error.message)):resolve();});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:makeManagerRemovalScript()}}));});
 }finally{socket.close();}
}
