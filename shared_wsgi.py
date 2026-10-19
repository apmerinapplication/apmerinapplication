"""Procurement-only cloud entrypoint. The separate quotation application is untouched."""
import os
from flask import Flask,redirect
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.middleware.proxy_fix import ProxyFix
from procurement_automation.shared_app import create_app

workflow_app=create_app()
store=workflow_app.extensions['workflow_store']
gateway=Flask('apmerin_procurement_gateway',static_folder=None)

@gateway.get('/')
def index():
    return redirect('/workflow/')

# No legacy application import, quotation routes, or quotation UI in this host.
application=DispatcherMiddleware(gateway,{'/workflow':workflow_app})
if os.environ.get('APMERIN_HTTPS')=='1':
    application=ProxyFix(application,x_for=1,x_proto=1,x_host=1)
