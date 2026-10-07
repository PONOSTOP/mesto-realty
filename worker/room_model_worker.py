"""Sequential, leased Nerfstudio worker. No third-party HTTP dependencies."""
import json
import base64
import io
import math
import os
from pathlib import Path
import signal
import ssl
import shutil
import struct
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urljoin
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
import uuid

IMAGE_LIMIT = 8 * 1024 * 1024
SCENE_LIMIT = 100 * 1024 * 1024
ACTIVE_PROCESSES = set()
ACTIVE_TEMPORARY_DIRECTORIES = set()
PROCESS_LOCK = threading.Lock()

def stop_process(process):
    if process.poll() is None:
        try:
            if os.name != 'nt': os.killpg(process.pid, signal.SIGKILL)
            else: process.kill()
        except ProcessLookupError:
            pass

def expire_task():
    # A hard watchdog also covers a slow HTTP peer. Docker restarts the worker;
    # the server reclaims the abandoned lease instead of accepting late output.
    with PROCESS_LOCK:
        for process in ACTIVE_PROCESSES:
            stop_process(process)
            process.wait(timeout=5)
        for directory in ACTIVE_TEMPORARY_DIRECTORIES:
            # Only exact, securely allocated job directories are registered.
            # Never follow a replaced root symlink or delete a computed parent.
            if directory.name.startswith('room-model-') and not directory.is_symlink():
                shutil.rmtree(directory, ignore_errors=True)
    print('Room reconstruction reached its hard time limit', flush=True)
    os._exit(1)

class StaleJob(Exception):
    pass

class APIError(RuntimeError):
    def __init__(self, status, code=None):
        super().__init__('Internal API request failed')
        self.status = status
        self.code = code

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirects are forbidden')

class Client:
    def __init__(self, origin, token, allow_local_http=False):
        parsed = urlsplit(origin)
        local = allow_local_http and parsed.hostname in ('localhost','127.0.0.1','::1')
        if (parsed.scheme != 'https' and not (local and parsed.scheme == 'http')) or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
            raise ValueError('Site origin must be an HTTPS origin')
        if not token or '\r' in token or '\n' in token:
            raise ValueError('Worker token is required')
        self.origin = origin.rstrip('/')
        self.token = token
        self.opener = build_opener(NoRedirect())

    def url(self, path):
        parsed = urlsplit(path)
        if parsed.scheme or parsed.netloc or parsed.fragment or not parsed.path.startswith(('/internal/room-models/','/internal/architectural-models/')) or '\\' in path or any(p in ('.','..') for p in parsed.path.split('/')):
            raise ValueError('Only internal relative API paths are permitted')
        return urljoin(self.origin, path)

    def request(self, path, data=None, content_type=None, extra_headers=None, timeout=30):
        headers = {'Authorization':'Bearer ' + self.token}
        headers.update(extra_headers or {})
        if content_type: headers['Content-Type'] = content_type
        req = Request(self.url(path), data=data, headers=headers)
        try:
            return self.opener.open(req, timeout=timeout)
        except HTTPError as error:
            status = error.code
            if status == 409:
                error.close()
                raise StaleJob() from None
            code = None
            try:
                value = json.loads(error.read(4096))
                if value.get('code') in ('unreadable_plan','invalid_layout','provider_unavailable','processing_failed'):
                    code = value['code']
            except (ValueError,AttributeError,TypeError):
                pass
            error.close()
            # Never include URLs, tokens or response bodies in logs.
            raise APIError(status,code) from None

    def json(self, path, body, timeout=30):
        with self.request(path, json.dumps(body).encode(), 'application/json', timeout=timeout) as response:
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024: raise ValueError('API response too large')
            return json.loads(data)

    def download(self, path, destination, revision, lease_token):
        for attempt in range(3):
            try:
                with self.request(path, extra_headers={'X-Room-Model-Revision':str(revision),'X-Room-Model-Lease':lease_token}, timeout=120) as response:
                    copy_bounded(response, destination, IMAGE_LIMIT)
                return
            except (URLError, TimeoutError, ssl.SSLError, ConnectionError):
                if attempt == 2: raise
                time.sleep(attempt + 1)

    def complete(self, path, fields, scene):
        if scene.stat().st_size > SCENE_LIMIT: raise ValueError('Scene too large')
        with scene.open('rb') as source:
            header = source.read(4096)
            if not header.startswith(b'ply\nformat binary_little_endian 1.0\n'):
                raise ValueError('Expected binary little-endian PLY')
        boundary = 'room-' + uuid.uuid4().hex
        parts = []
        for key, value in fields.items():
            parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode())
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="scene"; filename="scene.ply"\r\nContent-Type: application/octet-stream\r\n\r\n').encode())
        parts.extend([scene.read_bytes(), f'\r\n--{boundary}--\r\n'.encode()])
        # Large scenes can take minutes over a residential uplink. The job's
        # hard watchdog and heartbeats still bound work and protect its lease.
        payload = b''.join(parts)
        for attempt in range(3):
            try:
                with self.request(path, payload, 'multipart/form-data; boundary=' + boundary, timeout=1800) as response:
                    response.read(4096)
                return
            except (URLError, TimeoutError, ssl.SSLError, ConnectionError):
                if attempt == 2: raise
                time.sleep(attempt + 1)

def copy_bounded(source, destination, limit):
    try:
        with destination.open('xb') as target:
            total = 0
            while True:
                chunk = source.read(min(65536, limit - total + 1))
                if not chunk: break
                total += len(chunk)
                if total > limit: raise ValueError('Download too large')
                target.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

def image_extension(header):
    if header.startswith(b'\xff\xd8\xff'): return '.jpg'
    if header.startswith(b'\x89PNG\r\n\x1a\n'): return '.png'
    if header.startswith(b'RIFF') and header[8:12] == b'WEBP': return '.webp'
    raise ValueError('Unsupported photograph')

def convert_photograph(source, destination, max_pixels=40_000_000):
    # Pillow ships in the pinned Nerfstudio image. Nerfstudio 1.1.5 does not
    # discover WebP inputs, while the website stores processed images as WebP.
    import warnings
    from PIL import Image
    if source.stat().st_size > IMAGE_LIMIT: raise ValueError('Photograph too large')
    with source.open('rb') as data: image_extension(data.read(16))
    Image.MAX_IMAGE_PIXELS = 40_000_000
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(source) as image:
                if image.width <= 0 or image.height <= 0 or image.width * image.height > min(max_pixels,40_000_000):
                    raise ValueError('Photograph pixel limit exceeded')
                if getattr(image,'n_frames',1) != 1: raise ValueError('Animated photograph is unsupported')
                image.load()
                with image.convert('RGB') as rgb:
                    # 40 MP RGB bounds decoded storage and lossless PNG output.
                    rgb.save(destination,format='PNG')
    except Exception:
        destination.unlink(missing_ok=True)
        raise

def validate_job(job):
    for key in ('propertyId','revision'):
        if type(job.get(key)) is not int or job[key] <= 0: raise ValueError('Invalid job identity')
    if str(uuid.UUID(job['leaseToken'])) != job['leaseToken']: raise ValueError('Invalid lease')
    images = job.get('images')
    if not isinstance(images,list) or not 1 <= len(images) <= 200: raise ValueError('Invalid image count')
    ids = set()
    for image in images:
        if type(image.get('id')) is not int or image['id'] <= 0 or image['id'] in ids or not isinstance(image.get('url'),str): raise ValueError('Invalid image')
        expected = f"/internal/room-models/{job['propertyId']}/images/{image['id']}"
        if image['url'] != expected: raise ValueError('Invalid versioned image route')
        ids.add(image['id'])

def camera_from_transforms(data):
    frames = data.get('frames', [])
    if not frames: raise ValueError('No registered cameras')
    matrix = frames[0]['transform_matrix']
    if len(matrix) != 4 or any(len(row) != 4 for row in matrix): raise ValueError('Invalid camera matrix')
    values = [[float(x) for x in row] for row in matrix]
    if not all(math.isfinite(x) for row in values for x in row): raise ValueError('Nonfinite camera')
    # Nerfstudio transforms are OpenGL camera-to-world: +Y up, -Z forward.
    # Training explicitly disables automatic pose centering/orientation/scaling.
    position = [values[i][3] for i in range(3)]
    forward = [-values[i][2] for i in range(3)]
    up = [values[i][1] for i in range(3)]
    def norm(v): return math.sqrt(sum(x*x for x in v))
    cross = [forward[1]*up[2]-forward[2]*up[1],forward[2]*up[0]-forward[0]*up[2],forward[0]*up[1]-forward[1]*up[0]]
    if min(norm(forward),norm(up),norm(cross)) < 1e-6: raise ValueError('Degenerate camera')
    forward = [x/norm(forward) for x in forward]
    up = [x/norm(up) for x in up]
    return {'position':position,'target':[position[i]+forward[i] for i in range(3)],'up':up}

def best_colmap_model(processed):
    # COLMAP may emit disconnected components. Nerfstudio defaults to sparse/0,
    # which is not necessarily the component with the most registered images.
    best, best_count = None, 0
    sparse = processed/'colmap'/'sparse'
    candidates = [p for p in sparse.glob('*') if p.is_dir() and p.name.isdecimal()]
    for model in sorted(candidates, key=lambda p: int(p.name)):
        if not all((model/name).is_file() for name in ['cameras.bin','images.bin','points3D.bin']):
            continue
        with (model/'images.bin').open('rb') as file:
            header = file.read(8)
        if len(header) != 8: continue
        count = struct.unpack('<Q', header)[0]
        if best_count < count <= 200:
            best, best_count = model.relative_to(processed), count
    if best is None: raise ValueError('Missing COLMAP reconstruction')
    return best

def compact_scene(scene):
    # The web viewer renders degree-zero SH. Preserve its scalar attributes
    # byte-for-byte, omitting unused higher-order SH and normal coefficients.
    with scene.open('rb') as source:
        lines = []
        while sum(map(len, lines)) < 16384:
            line = source.readline()
            if not line: raise ValueError('Incomplete PLY header')
            lines.append(line)
            if line == b'end_header\n': break
        else: raise ValueError('PLY header too large')
        if lines[:2] != [b'ply\n', b'format binary_little_endian 1.0\n']: raise ValueError('Unsupported PLY')
        fields = [line.decode().strip().split()[-1] for line in lines if line.startswith(b'property float ')]
        count = int(next(line for line in lines if line.startswith(b'element vertex ')).split()[-1])
        payload = source.read(SCENE_LIMIT + 1)
    stride = len(fields) * 4
    if not stride or len(payload) != count * stride or len(payload) > SCENE_LIMIT: raise ValueError('Invalid PLY payload')
    kept = [index for index, name in enumerate(fields) if not name.startswith('f_rest_') and name not in ('nx','ny','nz')]
    output = bytearray(count * len(kept) * 4)
    position = 0
    view = memoryview(payload)
    for offset in range(0, len(payload), stride):
        for index in kept:
            output[position:position+4] = view[offset+index*4:offset+index*4+4]
            position += 4
    header = b''.join(line for line in lines if not line.startswith(b'property float ') or line.decode().strip().split()[-1] in [fields[index] for index in kept])
    replacement = scene.with_suffix('.compact')
    with replacement.open('wb') as target:
        target.write(header)
        target.write(output)
    replacement.replace(scene)

def commands(root):
    return [
        ['ns-process-data','images','--data',str(root/'images'),'--output-dir',str(root/'processed'),'--matching-method','exhaustive'],
        ['ns-train','splatfacto','--data',str(root/'processed'),'--output-dir',str(root/'outputs'),'--max-num-iterations','30000','--viewer.quit-on-train-completion','True','--vis','tensorboard','nerfstudio-data','--auto-scale-poses','False','--center-method','none','--orientation-method','none'],
    ]

class Lease:
    def __init__(self, client, job, timeout):
        self.client, self.job = client, job
        self.deadline = time.monotonic() + min(3600, max(60, timeout))
        self.next_heartbeat = 0
        self.path = '/internal/room-models/' + str(job['propertyId'])
        self.body = {'revision':job['revision'],'leaseToken':job['leaseToken']}

    def check(self):
        now = time.monotonic()
        if now >= self.deadline: raise TimeoutError('Task time limit reached')
        if now >= self.next_heartbeat:
            for attempt in range(3):
                try:
                    self.client.json(self.path+'/heartbeat', self.body)
                    break
                except (URLError, TimeoutError, ssl.SSLError, ConnectionError):
                    if attempt == 2: raise
                    time.sleep(attempt + 1)
            self.next_heartbeat = time.monotonic() + 60

    def complete(self, camera, scene):
        stopped = threading.Event()
        failures = []
        def renew():
            try:
                while not stopped.is_set():
                    self.check()
                    stopped.wait(1)
            except Exception as error:
                failures.append(error)
        heartbeat = threading.Thread(target=renew, daemon=True)
        heartbeat.start()
        try:
            self.client.complete(self.path+'/complete',{**self.body,'camera':json.dumps(camera,allow_nan=False)},scene)
            if failures: raise failures[0]
        finally:
            stopped.set()
            # A heartbeat has three 30-second attempts plus bounded backoff.
            # Finish that request before advancing to another job.
            heartbeat.join(timeout=95)

    def run(self, command):
        self.check()
        # No shell, no inherited credentials, and no unbounded command output logs.
        env = {key:value for key,value in os.environ.items() if key not in ('ROOM_MODEL_WORKER_TOKEN','ROOM_MODEL_SITE_ORIGIN')}
        process = subprocess.Popen(command, shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, start_new_session=(os.name != 'nt'))
        with PROCESS_LOCK: ACTIVE_PROCESSES.add(process)
        try:
            while process.poll() is None:
                self.check()
                time.sleep(1)
            if process.returncode != 0: raise RuntimeError('Reconstruction command failed')
        finally:
            if process.poll() is None:
                stop_process(process)
                process.wait()
            with PROCESS_LOCK: ACTIVE_PROCESSES.discard(process)

def process_job(client, job, timeout=3600):
    validate_job(job)
    lease = Lease(client, job, timeout)
    watchdog = threading.Timer(min(3600, max(60, timeout)), expire_task)
    watchdog.daemon = True
    watchdog.start()
    code = 'reconstruction_failed'
    try:
        with tempfile.TemporaryDirectory(prefix='room-model-') as directory:
            root = Path(directory)
            with PROCESS_LOCK: ACTIVE_TEMPORARY_DIRECTORIES.add(root)
            (root/'images').mkdir()
            for index, image in enumerate(job['images']):
                lease.check()
                path = root/'images'/f'{index:04d}.download'
                client.download(image['url'],path,job['revision'],job['leaseToken'])
                convert_photograph(path,path.with_suffix('.png'))
                path.unlink()
            preprocess, train = commands(root)
            lease.run(preprocess)
            selected = best_colmap_model(root/'processed')
            if selected != Path('colmap/sparse/0'):
                selected_path = root/'processed'/selected
                lease.run(['colmap','bundle_adjuster','--input_path',str(selected_path),'--output_path',str(selected_path),'--BundleAdjustment.refine_principal_point','1'])
                lease.run(['ns-process-data','images','--data',str(root/'images'),'--output-dir',str(root/'processed'),'--skip-colmap','--skip-image-processing','--colmap-model-path',str(selected)])
            transforms = json.loads((root/'processed'/'transforms.json').read_text())
            # Dataset metadata can override CLI orientation; keep scene and camera
            # in the processed coordinate frame explicitly.
            transforms['orientation_override'] = 'none'
            (root/'processed'/'transforms.json').write_text(json.dumps(transforms))
            if len(transforms.get('frames',[])) < max(3, math.ceil(len(job['images'])*0.5)):
                code = 'insufficient_overlap'
                raise ValueError('Insufficient registered photographs')
            camera = camera_from_transforms(transforms)
            code = 'reconstruction_failed'
            lease.run(train)
            configs = list((root/'outputs').rglob('config.yml'))
            if len(configs) != 1: raise ValueError('Missing unique training config')
            lease.run(['ns-export','gaussian-splat','--load-config',str(configs[0]),'--output-dir',str(root/'export')])
            scenes = list((root/'export').glob('*.ply'))
            if len(scenes) != 1: raise ValueError('Missing unique exported scene')
            compact_scene(scenes[0])
            lease.check()
            lease.complete(camera,scenes[0])
    except StaleJob:
        return
    except Exception:
        try: client.json(lease.path+'/fail',{**lease.body,'code':code})
        except StaleJob: pass
        except Exception: print('Failure notification unavailable', flush=True)
        print('Room reconstruction failed', flush=True)
    finally:
        watchdog.cancel()
        if 'root' in locals():
            with PROCESS_LOCK: ACTIVE_TEMPORARY_DIRECTORIES.discard(root)

def vision_image(source, size):
    import warnings
    from PIL import Image,ImageOps
    if source.stat().st_size > IMAGE_LIMIT: raise ValueError('Photograph too large')
    with source.open('rb') as data: image_extension(data.read(16))
    Image.MAX_IMAGE_PIXELS = 40_000_000
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(source) as image:
            if image.width <= 0 or image.height <= 0 or image.width * image.height > 40_000_000 or getattr(image,'n_frames',1) != 1:
                raise ValueError('Invalid vision image')
            image.load()
            with ImageOps.exif_transpose(image) as oriented:
                oriented.thumbnail((size,size),Image.Resampling.LANCZOS)
                with oriented.convert('RGB') as rgb:
                    output = io.BytesIO()
                    rgb.save(output,format='JPEG',quality=90)
                    return base64.b64encode(output.getvalue()).decode('ascii')

class LocalVision:
    def __init__(self, origin, model):
        parsed = urlsplit(origin)
        if parsed.scheme != 'http' or parsed.hostname not in ('room-model-vision','localhost','127.0.0.1','::1') or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
            raise ValueError('Only local Ollama HTTP origins are permitted')
        # The Docker service has one fixed port; loopback permits test ports.
        if parsed.hostname == 'room-model-vision' and parsed.port != 11434:
            raise ValueError('Unexpected Ollama service port')
        if not isinstance(model,str) or not model or len(model) > 128 or any(c in model for c in '\r\n'):
            raise ValueError('Invalid local vision model')
        self.url = origin.rstrip('/') + '/api/chat'
        self.model = model
        self.opener = build_opener(ProxyHandler({}),NoRedirect())

    def analyze(self, job, images, feedback=None):
        content = 'First image is the actual floor plan. Following images are room photographs. Authoritative dimensions in metres: ' + json.dumps(job['dimensions'],allow_nan=False) + '. Extract the actual layout, not the example. Return only JSON matching the supplied schema.'
        if feedback:
            content += ' Previous result failed validation. Regenerate from the same plan; use valid JSON, exact supplied dimensions, valid wall references, non-overlapping openings and objects within the footprint.'
        payload = {'model':self.model,'stream':False,'format':job['sceneSchema'],'messages':[{'role':'system','content':job['instructions']},{'role':'user','content':content,'images':images}],'options':{'temperature':0,'num_ctx':8192,'num_predict':6000},'keep_alive':0}
        # Separate opener and headers: site Bearer credentials never reach Ollama.
        request = Request(self.url,data=json.dumps(payload,allow_nan=False).encode(),headers={'Content-Type':'application/json'})
        try:
            with self.opener.open(request,timeout=900) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024: raise ValueError('Local vision response too large')
                response_value = json.loads(raw)
        except HTTPError as error:
            error.close()
            raise RuntimeError('Local vision unavailable') from None
        if not isinstance(response_value,dict) or response_value.get('error') or response_value.get('done') is not True:
            raise RuntimeError('Local vision unavailable')
        content = response_value.get('message',{}).get('content')
        if not isinstance(content,str): raise ValueError('Missing local vision JSON')
        scene = json.loads(content)
        if not isinstance(scene,dict): raise ValueError('Expected scene object')
        # Reject nonfinite JSON extensions before serializing to the site.
        if len(json.dumps(scene,allow_nan=False).encode()) > 1024 * 1024:
            raise ValueError('Local scene too large')
        return scene

def validate_architectural_job(job, local=False):
    if not isinstance(job, dict) or not isinstance(job.get('propertyId'), int) or job['propertyId'] <= 0 or not isinstance(job.get('revision'), int) or job['revision'] <= 0:
        raise ValueError('Invalid architectural job')
    if type(job['propertyId']) is not int or type(job['revision']) is not int: raise ValueError('Invalid architectural identity')
    uuid.UUID(job['leaseToken'])
    if not local: return
    path = '/internal/architectural-models/' + str(job['propertyId'])
    if not isinstance(job.get('dimensions'),dict) or not isinstance(job.get('instructions'),str) or not job['instructions'] or len(job['instructions']) > 65536 or not isinstance(job.get('sceneSchema'),dict):
        raise ValueError('Invalid local analysis contract')
    if not isinstance(job.get('plan'),dict) or job['plan'].get('url') != path+'/plan':
        raise ValueError('Invalid plan route')
    images = job.get('images',[])
    if not isinstance(images,list) or len(images) > 3: raise ValueError('Invalid representative image count')
    for image in images:
        url = image.get('url') if isinstance(image,dict) else None
        suffix = url[len(path+'/photos/'):] if isinstance(url,str) and url.startswith(path+'/photos/') else ''
        if not suffix.isascii() or not suffix.isdecimal() or int(suffix) <= 0: raise ValueError('Invalid representative image route')

def process_architectural_job(client, job, timeout=3600):
    local_origin = os.environ.get('ROOM_MODEL_LOCAL_VISION_URL','').strip()
    validate_architectural_job(job,bool(local_origin))
    lease = Lease(client, job, timeout)
    lease.path = '/internal/architectural-models/' + str(job['propertyId'])
    stopped = threading.Event()
    failures = []
    watchdog = threading.Timer(min(3600, max(60, timeout)), expire_task)
    watchdog.daemon = True
    watchdog.start()
    def renew():
        while not stopped.wait(1):
            try: lease.check()
            except Exception as error:
                failures.append(error)
                return
    heartbeat = threading.Thread(target=renew, daemon=True)
    code = 'processing_failed'
    root = None
    def check_current():
        if failures: raise failures[0]
        if time.monotonic() >= lease.deadline: raise TimeoutError('Task time limit reached')
    try:
        lease.check()
        heartbeat.start()
        if not local_origin:
            client.json(lease.path+'/analyze', lease.body, timeout=240)
            check_current()
        else:
            vision = LocalVision(local_origin,os.environ.get('ROOM_MODEL_LOCAL_VISION_MODEL','qwen2.5vl:3b'))
            with tempfile.TemporaryDirectory(prefix='room-model-') as directory:
                root = Path(directory)
                with PROCESS_LOCK: ACTIVE_TEMPORARY_DIRECTORIES.add(root)
                encoded_images = []
                for index, image in enumerate([job['plan']] + job.get('images',[])[:2]):
                    check_current()
                    destination = root/f'{index:04d}.download'
                    client.download(image['url'],destination,job['revision'],job['leaseToken'])
                    encoded_images.append(vision_image(destination,1600 if index == 0 else 768))
                    destination.unlink()
                    check_current()
                for attempt in range(2):
                    try:
                        code = 'vision_unavailable'
                        scene = vision.analyze(job,encoded_images,feedback=(attempt > 0))
                        check_current()
                        if scene.get('error') == 'unreadable_plan':
                            code = 'unreadable_plan'
                            raise RuntimeError('Unreadable plan')
                        code = 'invalid_layout'
                        client.json(lease.path+'/complete',{**lease.body,'scene':scene},timeout=120)
                        check_current()
                        break
                    except ValueError:
                        code = 'invalid_layout'
                        check_current()
                        if attempt == 1: raise
                    except APIError as error:
                        check_current()
                        if error.code == 'unreadable_plan':
                            code = 'unreadable_plan'
                            raise
                        if error.status != 422 or attempt == 1: raise
                        code = 'invalid_layout'
    except StaleJob:
        pass
    except Exception as error:
        # Server records known provider/validation errors itself. A late fail
        # after completed analysis is rejected by the revision/lease check.
        if failures and isinstance(failures[0],StaleJob): return
        if isinstance(error,TimeoutError): code = 'processing_timeout'
        try: client.json(lease.path+'/fail',{**lease.body,'code':code})
        except StaleJob: pass
        except Exception: print('Failure notification unavailable',flush=True)
        print('Architectural analysis failed',flush=True)
    finally:
        stopped.set()
        if heartbeat.is_alive(): heartbeat.join(timeout=95)
        watchdog.cancel()
        if root is not None:
            with PROCESS_LOCK: ACTIVE_TEMPORARY_DIRECTORIES.discard(root)

def main():
    client = Client(os.environ['ROOM_MODEL_SITE_ORIGIN'],os.environ['ROOM_MODEL_WORKER_TOKEN'],os.environ.get('ROOM_MODEL_ALLOW_LOCAL_HTTP') == '1')
    timeout = min(3600, max(60, int(os.environ.get('ROOM_MODEL_TASK_TIMEOUT_SECONDS','3600'))))
    while True:
        try:
            job = client.json('/internal/architectural-models/claim',{}).get('job')
            if job: process_architectural_job(client,job,timeout)
            else: time.sleep(10)
        except KeyboardInterrupt: return
        except Exception:
            print('Worker API unavailable', flush=True)
            time.sleep(10)

if __name__ == '__main__': main()
