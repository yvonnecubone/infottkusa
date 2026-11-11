const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=__dirname;
const MAP={'/':'/index.html','/login':'/login.html','/verification':'/verification.html','/cards':'/cards.html','/support':'/support.html','/support/chat':'/support-chat.html'};
const MIME={'.html':'text/html;charset=utf-8','.css':'text/css','.js':'application/javascript','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]).replace(/\/+$/,'')||'/';
  let file=MAP[p]||p;
  let full=path.join(ROOT,file);
  if(!full.startsWith(ROOT)){res.writeHead(403);return res.end();}
  fs.readFile(full,(e,buf)=>{
    if(e){res.writeHead(404,{'Content-Type':'text/html'});return res.end('<h1>Not Found</h1>');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream'});
    res.end(buf);
  });
}).listen(4599,()=>console.log('dev server em http://127.0.0.1:4599'));
