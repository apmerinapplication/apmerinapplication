"""Vercel Flask entrypoint. Cloud-only persistence; no desktop runtime or daemon."""
import os
import tempfile
from pathlib import Path
from flask import Flask
from procurement_automation.cloud_config import validate_cloud_environment


validate_cloud_environment()
os.environ['APMERIN_DATA_DIR']=str(Path(tempfile.gettempdir())/'apmerin-web-scratch')
os.environ['APMERIN_HTTPS']='1'
os.environ['APMERIN_TRIAL']='0'
os.environ['APMERIN_DEMO']='0'
from shared_wsgi import application

# Vercel discovers this Flask instance. The existing authenticated quotation tools
# remain available, and / redirects to the shared dashboard at /workflow/.
app=Flask('apmerin_web',static_folder=None)
app.wsgi_app=application
