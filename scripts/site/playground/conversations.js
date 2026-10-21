import { html, Command } from '../lib/aster-ui.js';
import { ConversationSession } from '../lib/aster-ui-preview.js';

const $ = id => document.getElementById(id);
const reader = $('reader');
const database = new Map(), sessions = new Map(), readerCommands = new Map();
let active = 'chat', failNext = false, counter = 1000;
const authors = ['Maya Chen', 'Oliver Reed', 'Amira Lewis'];
const lines = [
  'The revised layout keeps the message readable while leaving room for its context.',
  'When earlier messages arrive, the paragraph we are reading should stay in place.',
  'We can follow a discussion without giving up our draft in the main conversation.',
  'A named topic does not need to treat its first message as a special root.',
  'The return action should restore both reading position and keyboard focus.',
  'Keep fresh activity discoverable without pulling someone away from older messages.',
  'Let’s test this with a longer exchange and a slow-loading attachment.',
];
const titles = {chat:'# product-design', email:'Conversation review · next steps',ticket:'AST-2048 · Customer replies',topic:'Topic: keeping reading context'};
for(const scope of Object.keys(titles)) {
  const entries = Array.from({length:160},(_,i)=>({id:scope+'-'+i,cursor:String(i),order:String(i).padStart(6,'0'),author:authors[i%3],time:'20 Oct · '+String(8+Math.floor(i/60)).padStart(2,'0')+':'+String(i%60).padStart(2,'0'),text:lines[i%lines.length],discussion:i%7===0?'navigation':undefined,revision:'1',kind:scope==='ticket'&&i%8===0?'note':scope==='ticket'&&i%9===0?'event':'message'}));
  if(scope==='email')for(const [i,entry] of entries.entries())entry.text=`Hi both,\n\n${lines[i%lines.length]}\n\nThe important detail is that opening context should feel like a short detour. We can inspect the earlier exchange and return to the paragraph we were reading.\n\nLet’s agree the behaviour before settling the API.\n\nThanks,\n${entry.author.split(' ')[0]}`;
  database.set(scope,entries);
}
function delay(signal,ms=220){return new Promise((resolve,reject)=>{if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});});}
const windowFor=(scope,start,end)=>{const rows=database.get(scope)||[];return {entries:rows.slice(start,end),hasOlder:start>0,hasNewer:end<rows.length};};
const adapter={
  async open({scope,at,signal}){await delay(signal);const rows=database.get(scope)||[];if(at==='latest')return windowFor(scope,Math.max(0,rows.length-24),rows.length);const atIndex=rows.findIndex(row=>row.id===at.entryId);return atIndex<0?{entries:[],hasOlder:false,hasNewer:false}:windowFor(scope,Math.max(0,atIndex-12),Math.min(rows.length,atIndex+13));},
  async older({scope,before,signal}){await delay(signal,450);if(failNext){failNext=false;throw new Error('History is temporarily unavailable.');}const rows=database.get(scope)||[];const index=rows.findIndex(row=>row.cursor===before);return windowFor(scope,Math.max(0,index-20),index);},
  async newer({scope,after,signal}){await delay(signal);const rows=database.get(scope)||[],index=rows.findIndex(row=>row.cursor===after)+1;return windowFor(scope,index,Math.min(rows.length,index+20));},
  async send({scope,text,signal}){await delay(signal,350);const rows=database.get(scope),n=++counter;const entry={id:scope+'-sent-'+n,cursor:String(n),order:String(n).padStart(6,'0'),author:'You',time:'Just now',text,revision:'1',kind:scope.startsWith('internal-')?'note':'message'};rows.push(entry);return entry;}
};
function options(scope,title){return {scope,title,adapter,maxEntries:80};}
function getSession(scope){if(!sessions.has(scope)){const session=new ConversationSession(options(scope,titles[scope]));sessions.set(scope,session);void session.open();}return sessions.get(scope);}
reader.contextProvider=(entry,scope)=>{
  const key=database.has(entry.discussion)?entry.discussion:scope+'/'+entry.discussion;
  if(!database.has(key))database.set(key,Array.from({length:6},(_,i)=>({id:key+'-'+i,cursor:String(i),order:String(i).padStart(6,'0'),author:authors[i%3],time:'Earlier today',text:i===0?entry.text:lines[(i+1)%lines.length],discussion:i===2?'details':undefined,kind:entry.kind==='note'?'note':'message'})));
  return options(key,key.startsWith('internal-')?'Internal · passage discussion':key.startsWith('passage-')?'Passage discussion':'Discussion · keeping your place');
};
function passageProvider(passage,signal){return new Promise(resolve=>{
  const dialog=$('passage-dialog');
  if(dialog.open||signal.aborted){resolve(undefined);return;}
  $('passage-author').textContent='Quoted from '+passage.entry.author;
  $('passage-quote').value=passage.exact;$('passage-title').value='';$('passage-comment').value='';$('passage-error').hidden=true;
  $('passage-audience').textContent=passage.entry.kind==='note'?'Internal discussion · support team only. Audience inherited from the source.':'Same audience as the source conversation. No original content is moved.';
  const close=()=>{cleanup();resolve(undefined);};
  const abort=()=>dialog.close();
  const cleanup=()=>{dialog.removeEventListener('close',close);signal.removeEventListener('abort',abort);$('passage-form').removeEventListener('submit',submit);};
  const submit=event=>{
    event.preventDefault();const quote=$('passage-quote').value,title=$('passage-title').value.trim(),offset=passage.entry.text.indexOf(quote);
    if(!title||!quote.trim()||offset<0||(quote!==passage.exact&&passage.entry.text.indexOf(quote,offset+1)>=0)){$('passage-error').textContent='Enter a title and an exact, unambiguous passage from the message.';$('passage-error').hidden=false;return;}
    const key=(passage.entry.kind==='note'?'internal-':'passage-')+crypto.randomUUID();
    const items=[{id:key+'-quote',cursor:'0',order:'000000',author:passage.entry.author,time:'Source revision '+(passage.entry.revision||'unknown'),text:quote,kind:passage.entry.kind==='note'?'note':'message',data:{sourceScope:passage.scope,sourceId:passage.entry.id,revision:passage.entry.revision,exact:quote,start:quote===passage.exact?passage.start:offset}}];
    if($('passage-comment').value.trim())items.push({id:key+'-first',cursor:'1',order:'000001',author:'You',time:'Just now',text:$('passage-comment').value.trim(),kind:passage.entry.kind==='note'?'note':'message'});
    database.set(key,items);
    const rows=database.get(passage.scope),index=rows.findIndex(row=>row.id===passage.entry.id);
    if(index>=0){rows[index]={...rows[index],contexts:[...(rows[index].contexts||[]),{id:key,label:title}]};reader.receive(passage.scope,rows[index]);}
    cleanup();dialog.close();getSelection()?.removeAllRanges();resolve(options(key,(passage.entry.kind==='note'?'Internal · ':'')+title));
  };
  dialog.addEventListener('close',close);signal.addEventListener('abort',abort,{once:true});$('passage-form').addEventListener('submit',submit);dialog.showModal();$('passage-title').focus();
});}
$('cancel-passage').addEventListener('click',()=>$('passage-dialog').close());
reader.readerActions=session=>{
  if(!readerCommands.has(session.scope))readerCommands.set(session.scope,[
    new Command({label:'Copy loaded messages',run:()=>navigator.clipboard.writeText(session.entries.peek().map(entry=>entry.author+' · '+entry.time+'\n'+entry.text).join('\n\n'))}),
    new Command({label:'Download loaded messages',run:()=>{const text=session.entries.peek().map(entry=>entry.author+' · '+entry.time+'\n'+entry.text).join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='conversation.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}),
  ]);
  return readerCommands.get(session.scope);
};
function configure(){
  reader.session=getSession(active);
  reader.entryRenderer=active==='email'?entry=>html`<div class="ac-email"><p class="demo-email-meta">To: you, Maya Chen, Oliver Reed</p><p>${entry.text}</p><div class="demo-attachment">Review notes.pdf · simulated attachment</div><details><summary>Show quoted history</summary><blockquote><p>Earlier feedback: preserve reading position when content expands.</p><div class="demo-resize">Expanded context</div></blockquote></details></div>`:undefined;
  reader.passageProvider=$('passages').checked&&active!=='email'?passageProvider:undefined;
  $('passages').disabled=active==='email';
  $('demo-note').textContent=active==='email'?'Email uses a custom renderer. Passage selection is disabled until it provides a canonical text mapper. Expand a quote to test reading anchors.':'Simulated delivery and visibility. No server writes or read receipts. At most 80 entries per window; focused/selected messages are protected.';
}
$('configuration').addEventListener('change',()=>{active=$('configuration').value;configure();});
$('passages').addEventListener('change',configure);
$('auto-history').addEventListener('change',()=>{reader.autoLoadHistory=$('auto-history').checked;});
$('failure').addEventListener('click',()=>{failNext=true;$('demo-status').textContent='The next older-history request will fail. Loaded content will remain available.';});
$('arrival').addEventListener('click',()=>{const rows=database.get(active),n=++counter,entry={id:active+'-arrival-'+n,cursor:String(n),order:String(n).padStart(6,'0'),author:'Maya Chen',time:'Just now',text:'A new message arrived while you were reading. Your position should stay unchanged.',revision:'1'};rows.push(entry);reader.receive(active,entry);});
configure();
window.conversationDemo={reader,sessions,database,adapter,get active(){return active;}};
addEventListener('pagehide',()=>{for(const session of sessions.values())session.dispose();for(const commands of readerCommands.values())for(const command of commands)command.dispose();},{once:true});
