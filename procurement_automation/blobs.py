"""Private evidence storage, independent of the web host's temporary filesystem."""
import io
import json
import os
import re
import urllib.request
import urllib.error
import urllib.parse


class LocalBlob:
    def __init__(self, store, folder, name):
        if folder not in ['attachments', 'original_emails'] or not re.fullmatch(r'[a-f0-9]{64}(?:\.eml)?', name):
            raise ValueError('Invalid evidence path')
        self.path = store.directory / folder / name

    def exists(self):return self.path.is_file()
    is_file = exists
    def read_bytes(self):return self.path.read_bytes()
    def write_bytes(self, raw):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(raw)
    def download(self):return self.path


class CloudBlob(LocalBlob):
    def __init__(self, store, folder, name):
        super().__init__(store, folder, name)
        self.url = os.environ.get('APMERIN_SUPABASE_URL', '').rstrip('/')
        self.secret = os.environ.get('APMERIN_SUPABASE_SERVICE_KEY', '')
        bucket = os.environ.get('APMERIN_STORAGE_BUCKET', 'apmerin-evidence')
        if not self.url.startswith('https://') or not self.secret:
            raise RuntimeError('Configure private Supabase Storage on the server')
        self.object = urllib.parse.quote(bucket + '/' + folder + '/' + name, safe='/')

    def _request(self, route, raw=None):
        req = urllib.request.Request(self.url + '/storage/v1/' + route + '/' + self.object,
            data=raw, headers={'Authorization': 'Bearer ' + self.secret, 'apikey': self.secret,
            'Content-Type': 'application/octet-stream', 'x-upsert': 'true'})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:return response.read()
        except urllib.error.HTTPError as exc:
            # Some Storage versions report a missing object as 400, not 404.
            code = ''
            try:code = str(json.loads(exc.read()).get('statusCode', ''))
            except (ValueError, AttributeError):pass
            if exc.code == 404 or exc.code == 400 and code == '404':raise FileNotFoundError('Evidence object missing') from None
            raise RuntimeError('Private evidence storage request failed (' + str(exc.code) + ')') from None

    def exists(self):
        try:self._request('object/info/authenticated');return True
        except FileNotFoundError:return False
    is_file = exists
    def read_bytes(self):return self._request('object/authenticated')
    def write_bytes(self, raw):self._request('object', raw)
    def download(self):return io.BytesIO(self.read_bytes())

    def signed_download(self, filename=None):
        # A short, object-scoped capability, issued only after app session checks.
        req=urllib.request.Request(self.url+'/storage/v1/object/sign/'+self.object,
            data=json.dumps(dict(expiresIn=60)).encode(),headers={'Authorization':'Bearer '+self.secret,
            'apikey':self.secret,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=15) as response:data=json.load(response)
            signed=data.get('signedURL') or data.get('signedUrl')
            if not signed or not signed.startswith('/object/sign/'):raise ValueError('Invalid signed URL')
            url=self.url+'/storage/v1'+signed
            if filename:url+=('&' if '?' in url else '?')+'download='+urllib.parse.quote(filename,safe='')
            return url
        except Exception:raise RuntimeError('Private evidence link could not be created') from None
