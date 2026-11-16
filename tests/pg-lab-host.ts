import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { Duplex } from "node:stream";

const distro = process.env.GODSEYE_PG_WSL_DISTRO ?? "Ubuntu";
const timeout = 90_000;
export const pythonHost = String.raw`
import json,os,pathlib,shutil,socket,subprocess,sys,tempfile
p=json.load(sys.stdin)
tool=pathlib.Path(p['tool'])
env={**os.environ,'LD_LIBRARY_PATH':str(tool/'usr/lib/x86_64-linux-gnu')}
bin=tool/'usr/lib/postgresql/18/bin'
def run(args):
 result=subprocess.run([str(x) for x in args],capture_output=True,text=True,env=env,timeout=60)
 if result.returncode: raise RuntimeError('Native PostgreSQL laboratory command failed: '+str(args[0])+' '+result.stderr[-1200:])
 return result.stdout
def owned(root):
 path=pathlib.Path(root)
 if path.parent!=pathlib.Path(tempfile.gettempdir()) or not path.name.startswith('godseye-pg-lab-') or path.resolve()!=path or path.stat().st_uid!=os.getuid() or not (path/'.godseye-owned').is_file():
  raise RuntimeError('Refusing non-owned PostgreSQL laboratory cleanup')
 return path
if p['action']=='setup':
 root=pathlib.Path(tempfile.mkdtemp(prefix='godseye-pg-lab-'))
 (root/'.godseye-owned').write_text('disposable native PostgreSQL lab')
 try:
  run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',root/'ca.key','-out',root/'ca.crt','-days','1','-subj','/CN=Disposable PostgreSQL Laboratory CA'])
  cells=[]
  for index,config in enumerate(p['cells']):
   cell=root/str(index); cell.mkdir(mode=0o700)
   password=cell/'bootstrap.pass'; password.write_text(config['admin']); password.chmod(0o600)
   run([bin/'initdb','-D',cell/'data','-X',cell/'wal','-L',tool/'usr/share/postgresql/18','--no-locale','--encoding=UTF8','--username=lab_admin','--auth-local=scram-sha-256','--auth-host=reject','--pwfile='+str(password)])
   password.unlink()
   servername='cell-'+str(index)+'.localhost'
   run(['openssl','req','-newkey','rsa:2048','-nodes','-keyout',cell/'server.key','-out',cell/'server.csr','-subj','/CN='+servername])
   (cell/'extensions').write_text('subjectAltName=DNS:'+servername+'\nextendedKeyUsage=serverAuth\n')
   run(['openssl','x509','-req','-in',cell/'server.csr','-CA',root/'ca.crt','-CAkey',root/'ca.key','-CAcreateserial','-out',cell/'server.crt','-days','1','-extfile',cell/'extensions'])
   (cell/'server.key').chmod(0o600)
   sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]; sock.close()
   def quote(v): return "'"+str(v).replace("'","''")+"'"
   settings={**config['settings'],'listen_addresses':'127.0.0.1','port':str(port),'unix_socket_directories':str(cell),'unix_socket_permissions':'0700','ssl_cert_file':str(cell/'server.crt'),'ssl_key_file':str(cell/'server.key')}
   (cell/'data/postgresql.conf').write_text('\n'.join(k+' = '+quote(v) for k,v in settings.items())+'\n')
   (cell/'data/pg_hba.conf').write_text(config['hba'])
   run([bin/'pg_ctl','-D',cell/'data','-l',cell/'postgres.log','-w','start'])
   cells.append({'port':port,'servername':servername,'socket':str(cell/('.s.PGSQL.'+str(port))),'data':str(cell/'data'),'wal':str((cell/'data/pg_wal').resolve())})
  print(json.dumps({'root':str(root),'cells':cells,'ca':(root/'ca.crt').read_text()}))
 except Exception:
  for cell in root.iterdir():
   if cell.is_dir() and (cell/'data/postmaster.pid').exists(): run([bin/'pg_ctl','-D',cell/'data','-m','immediate','-w','stop'])
  shutil.rmtree(owned(str(root)))
  raise
elif p['action']=='cleanup':
 root=owned(p['root'])
 for cell in root.iterdir():
  if cell.is_dir() and (cell/'data/postmaster.pid').exists(): run([bin/'pg_ctl','-D',cell/'data','-m','fast','-w','stop'])
 shutil.rmtree(root)
 print('{}')
elif p['action']=='restart':
 root=owned(p['root']); cell=root/str(int(p['index']))
 run([bin/'pg_ctl','-D',cell/'data','-m','fast','-w','restart','-l',cell/'postgres.log'])
 print('{}')
`;

export async function toolPath(): Promise<string> {
  const path = resolve("artifacts/tools/postgres/18.6/root");
  if (process.platform !== "win32") return path;
  return new Promise((accept, reject) => {
    execFile(
      "wsl",
      ["-d", distro, "--exec", "wslpath", "-u", path.replaceAll("\\", "/")],
      { windowsHide: true, timeout },
      (error, stdout) => {
        if (error) reject(new Error("WSL PostgreSQL tool path is unavailable"));
        else accept(stdout.trim());
      },
    );
  });
}

function python(code: string, args: string[] = []): ChildProcessWithoutNullStreams {
  return process.platform === "win32"
    ? spawn("wsl", ["-d", distro, "--exec", "python3", "-c", code, ...args], {
        windowsHide: true,
        stdio: "pipe",
      })
    : spawn("python3", ["-c", code, ...args], { stdio: "pipe" });
}

export async function hostCommand<T>(input: Record<string, unknown>): Promise<T> {
  const child = python(pythonHost);
  let output = "";
  let diagnostic = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    diagnostic += chunk.toString();
  });
  child.stdin.end(JSON.stringify(input));
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Native PostgreSQL lab command timed out"));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error(`Native PostgreSQL lab host command failed: ${diagnostic.slice(-1600)}`));
      else accept(JSON.parse(output) as T);
    });
  });
}

const socketRelay = `
import socket,sys,select,os
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(sys.argv[1])
while True:
 ready,_,_=select.select([s,sys.stdin.buffer],[],[])
 if s in ready:
  data=s.recv(65536)
  if not data: break
  os.write(1,data)
 if sys.stdin.buffer in ready:
  data=os.read(0,65536)
  if not data: break
  s.sendall(data)
s.close()
`;

/** Private Unix-socket transport; no TCP bootstrap-admin exception is required. */
export class PgLabUnixStream extends Duplex {
  private child?: ChildProcessWithoutNullStreams;
  constructor(private readonly socket: string) {
    super();
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  connect() {
    this.child = python(socketRelay, [this.socket]);
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.push(chunk);
    });
    this.child.stdout.on("end", () => this.push(null));
    this.child.on("error", (error) => this.destroy(error));
    this.child.on("close", (code) => {
      if (code && !this.destroyed)
        this.destroy(new Error("Private PostgreSQL socket relay closed"));
    });
    this.child.stdin.on("error", (error) => {
      if (!this.destroyed) this.destroy(error);
    });
    queueMicrotask(() => this.emit("connect"));
    return this;
  }
  _read() {}
  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (!this.child) return callback(new Error("Private PostgreSQL socket relay is not connected"));
    this.child.stdin.write(chunk, encoding, callback);
  }
  _final(callback: (error?: Error | null) => void) {
    this.child?.stdin.end();
    callback();
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.child?.kill();
    callback(error);
  }
}
