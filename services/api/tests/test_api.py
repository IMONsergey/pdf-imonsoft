import time
from dataclasses import replace
from fastapi.testclient import TestClient
from app.main import create_app
from app.jobs import QueueFull,JobStore
HEADERS={'X-IMONSOFT-Client':'web'}

def wait_for_job(client,job_id):
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        response=client.get(f'/api/v1/jobs/{job_id}');assert response.status_code==200
        job=response.json()
        if job['state'] in ('done','error','cancelled'):return job
        time.sleep(.1)
    raise AssertionError('Worker did not finish')

def test_end_to_end_and_ownership(sample_pdf,settings):
    app=create_app(settings)
    with TestClient(app) as c:
        assert c.get('/api/v1/config').status_code==200
        response=c.post('/api/v1/jobs',headers=HEADERS,data={'tool':'rotate-pdf','options':'{"angle":90}'},files={'files':('report.pdf',sample_pdf.read_bytes())})
        assert response.status_code==202,response.text
        jid=response.json()['id'];job=wait_for_job(c,jid)
        assert job['state']=='done',job
        other=TestClient(app)
        for suffix in ('','/download'):
            assert other.get(f'/api/v1/jobs/{jid}{suffix}').status_code==404
        assert other.post(f'/api/v1/jobs/{jid}/cancel',headers=HEADERS).status_code==404
        assert other.delete(f'/api/v1/jobs/{jid}',headers=HEADERS).status_code==404
        result=c.get(job['downloadUrl']);assert result.status_code==200 and result.content.startswith(b'%PDF-')
        assert 'attachment' in result.headers['content-disposition']
        assert not (app.state.store.root/jid/'input').exists()
        assert not (app.state.store.root/jid/'manifest.json').exists()
        assert c.delete(f'/api/v1/jobs/{jid}',headers=HEADERS).status_code==204
        assert c.get(job['downloadUrl']).status_code==404
        assert not (app.state.store.root/jid).exists()

def test_validation(sample_pdf,settings):
    with TestClient(create_app(settings)) as c:
        files={'files':('report.pdf',sample_pdf.read_bytes())}
        assert c.post('/api/v1/jobs',data={'tool':'rotate-pdf'},files=files).status_code==403
        assert c.post('/api/v1/jobs',headers={**HEADERS,'Origin':'https://evil.example'},data={'tool':'rotate-pdf'},files=files).status_code==403
        for tool,status,opts in [('unknown',400,'{}'),('merge-pdf',422,'{}'),('extract-pages',422,'{}'),('rotate-pdf',422,'{"angle":12}'),('protect-pdf',422,'{"new_password":"123"}')]:
            assert c.post('/api/v1/jobs',headers=HEADERS,data={'tool':tool,'options':opts},files=files).status_code==status
        assert c.post('/api/v1/jobs',headers=HEADERS,data={'tool':'rotate-pdf'},files={'files':('bad.exe',b'MZ')}).status_code==415
        assert c.post('/api/v1/jobs',headers=HEADERS,data={'tool':'rotate-pdf'},files={'files':('empty.pdf',b'')}).status_code==422

def test_bad_file_failure(settings):
    app=create_app(settings)
    with TestClient(app) as c:
        r=c.post('/api/v1/jobs',headers=HEADERS,data={'tool':'pdf-to-pptx'},files={'files':('file.pdf',b'fake PDF')})
        job=wait_for_job(c,r.json()['id'])
        assert job['state']=='error' and job['downloadUrl'] is None
        assert not (app.state.store.root/job['id']/'input').exists()

def test_body_limit(settings):
    with TestClient(create_app(replace(settings,max_upload_mb=1))) as c:
        r=c.post('/api/v1/jobs',headers=HEADERS,data={'tool':'rotate-pdf'},files={'files':('large.pdf',b'x'*(3*1024*1024))})
        assert r.status_code==413

def test_expiry(settings,sample_pdf):
    app=create_app(settings)
    with TestClient(app) as c:
        r=c.post('/api/v1/jobs',headers=HEADERS,data={'tool':'rotate-pdf'},files={'files':('a.pdf',sample_pdf.read_bytes())})
        job=wait_for_job(c,r.json()['id'])
        with app.state.store.connect() as db:db.execute('UPDATE jobs SET expires=? WHERE id=?',(time.time()-1,job['id']))
        assert c.get(job['downloadUrl']).status_code==404
        assert c.get('/api/v1/jobs').json()['jobs']==[]

def test_store_capacity(settings):
    s=JobStore(settings);ids=['a'*31+str(i) for i in range(4)]
    for jid in ids[:3]:s.create(jid,'same','rotate-pdf',['a.pdf'],100)
    try:
        s.create(ids[3],'same','rotate-pdf',['a.pdf'],100);assert False
    except QueueFull:pass
    s.cancel(ids[0]);assert s.get(ids[0])['state']=='cancelled'
    s.create(ids[3],'same','rotate-pdf',['a.pdf'],100)


def test_chunked_body_limit(settings):
    app=create_app(replace(settings,max_upload_mb=1))
    boundary='imonsoft-test-boundary'
    def chunks():
        yield f'--{boundary}\r\nContent-Disposition: form-data; name="tool"\r\n\r\nrotate-pdf\r\n--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="large.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
        for _ in range(40):
            yield b'x'*65536
        yield f'\r\n--{boundary}--\r\n'.encode()
    with TestClient(app) as c:
        r=c.post('/api/v1/jobs',headers={**HEADERS,'Content-Type':f'multipart/form-data; boundary={boundary}'},content=chunks())
        assert r.status_code==413,r.text
        assert c.get('/api/v1/jobs').json()['jobs']==[]
