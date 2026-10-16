# -*- coding: utf-8 -*-
"""
AP Merin Services - Cross-Device Data Synchronization Engine
Handles persistent local storage (SQLite) and cross-device sync
between Windows and macOS (Apple) laptops.

Supports:
1. Local SQLite storage (ap_merin_data.sqlite)
2. Shared Cloud Folder sync (OneDrive, Google Drive, Dropbox, iCloud Drive)
3. One-click Export / Import sync bundle (.apmerin_sync / JSON)
4. Multi-device tracking & conflict-free upserts
"""

import os
import sys
import json
import sqlite3
import socket
import platform
import uuid
import datetime
import hashlib
import shutil
import re
import csv
import io

def get_persistent_data_dir():
    """
    Returns the permanent, persistent application data directory for AP Merin Services.
    This directory is independent of PyInstaller build folders and never wiped on app updates.
    """
    if os.environ.get('APMERIN_DATA_DIR'):
        app_dir=os.path.abspath(os.environ['APMERIN_DATA_DIR'])
        os.makedirs(app_dir,exist_ok=True)
        return app_dir
    if sys.platform == 'win32':
        base = os.environ.get('APPDATA', os.path.expanduser('~'))
    elif sys.platform == 'darwin':
        base = os.path.expanduser('~/Library/Application Support')
    else:
        base = os.path.expanduser('~')
    app_dir = os.path.join(base, 'AP_Merin_Services')
    try:
        os.makedirs(app_dir, exist_ok=True)
    except Exception:
        pass
    return app_dir

PERSISTENT_DATA_DIR = get_persistent_data_dir()
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__)) if not getattr(sys, 'frozen', False) else os.path.dirname(sys.executable)
BASE_DIR = PERSISTENT_DATA_DIR
DEFAULT_DB_NAME = 'ap_merin_data.sqlite'
CONFIG_FILE = os.path.join(PERSISTENT_DATA_DIR, 'sync_config.json')
PROFILES_FILE = os.path.join(PERSISTENT_DATA_DIR, 'ap_merin_user_profiles.json')
SESSION_FILE = os.path.join(PERSISTENT_DATA_DIR, 'auth_session.json')
CONTACTS_FILE = os.path.join(PERSISTENT_DATA_DIR, 'ap_merin_contacts.json')

def _migrate_initial_data():
    """
    Ensures that if database, profiles, or config files exist in the project directory,
    portable bundle, or PyInstaller package, they are automatically copied into the
    persistent data directory so all user accounts, passwords, default CCs, and signatures
    are permanently available on any laptop!
    """
    exe_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else ''
    mei_pass = getattr(sys, '_MEIPASS', '')
    src_candidates = [
        exe_dir,
        os.path.join(exe_dir, '_internal') if exe_dir else '',
        mei_pass,
        PROJECT_DIR,
        os.path.dirname(os.path.abspath(__file__)),
        os.getcwd(),
        r"C:\Users\Victus\Desktop\AP MERIN APPLICATION",
        r"C:\Users\Victus\AppData\Roaming\AP_Merin_Services"
    ]
    for src_dir in src_candidates:
        if not src_dir or not os.path.isdir(src_dir) or os.path.abspath(src_dir) == os.path.abspath(PERSISTENT_DATA_DIR):
            continue

        # 1. Migrate JSON profiles (with all 5 users, passwords, CC, and HTML signatures)
        src_json = os.path.join(src_dir, 'ap_merin_user_profiles.json')
        dst_json = os.path.join(PERSISTENT_DATA_DIR, 'ap_merin_user_profiles.json')
        if os.path.exists(src_json):
            src_sz = os.path.getsize(src_json)
            dst_sz = os.path.getsize(dst_json) if os.path.exists(dst_json) else 0
            should_copy = not os.path.exists(dst_json) or dst_sz == 0 or (src_sz > 50000 and dst_sz < src_sz / 2)
            if not should_copy and os.path.exists(dst_json):
                try:
                    if os.path.getmtime(src_json) > os.path.getmtime(dst_json):
                        should_copy = True
                except Exception:
                    pass
            if should_copy:
                try:
                    shutil.copy2(src_json, dst_json)
                    print(f"[*] Successfully migrated user profiles ({src_sz} bytes) to {dst_json}")
                except Exception as e:
                    print(f"Notice: user profiles migration error: {e}")

        # 2. Migrate SQLite DB
        src_db = os.path.join(src_dir, DEFAULT_DB_NAME)
        dst_db = os.path.join(PERSISTENT_DATA_DIR, DEFAULT_DB_NAME)
        if os.path.exists(src_db):
            src_db_sz = os.path.getsize(src_db)
            dst_db_sz = os.path.getsize(dst_db) if os.path.exists(dst_db) else 0
            if not os.path.exists(dst_db) or dst_db_sz == 0 or (src_db_sz > 100000 and dst_db_sz < src_db_sz / 2):
                try:
                    shutil.copy2(src_db, dst_db)
                    print(f"[*] Successfully migrated database ({src_db_sz} bytes) to {dst_db}")
                except Exception as e:
                    print(f"Notice: database migration error: {e}")

        # 3. Migrate auth session
        src_sess = os.path.join(src_dir, 'auth_session.json')
        dst_sess = os.path.join(PERSISTENT_DATA_DIR, 'auth_session.json')
        if os.path.exists(src_sess) and (not os.path.exists(dst_sess) or os.path.getsize(dst_sess) == 0):
            try:
                shutil.copy2(src_sess, dst_sess)
            except Exception:
                pass

        # 4. Migrate sync config
        src_cfg = os.path.join(src_dir, 'sync_config.json')
        dst_cfg = os.path.join(PERSISTENT_DATA_DIR, 'sync_config.json')
        if os.path.exists(src_cfg) and not os.path.exists(dst_cfg):
            try:
                shutil.copy2(src_cfg, dst_cfg)
            except Exception:
                pass

        # 5. Migrate contacts JSON (Address Book)
        src_contacts = os.path.join(src_dir, 'ap_merin_contacts.json')
        dst_contacts = os.path.join(PERSISTENT_DATA_DIR, 'ap_merin_contacts.json')
        if os.path.exists(src_contacts):
            src_c_sz = os.path.getsize(src_contacts)
            dst_c_sz = os.path.getsize(dst_contacts) if os.path.exists(dst_contacts) else 0
            should_copy_c = not os.path.exists(dst_contacts) or dst_c_sz == 0 or src_c_sz > dst_c_sz
            if not should_copy_c and os.path.exists(dst_contacts):
                try:
                    if os.path.getmtime(src_contacts) > os.path.getmtime(dst_contacts):
                        should_copy_c = True
                except Exception:
                    pass
            if should_copy_c:
                try:
                    shutil.copy2(src_contacts, dst_contacts)
                    print(f"[*] Successfully migrated contacts ({src_c_sz} bytes) to {dst_contacts}")
                except Exception as e:
                    print(f"Notice: contacts migration error: {e}")

try:
    if os.environ.get('APMERIN_SHARED_MODE') != '1':
        _migrate_initial_data()
except Exception as _m_err:
    print(f"Notice: Initial data migration notice: {_m_err}")

def get_machine_id():
    """Returns a persistent, unique identifier for this machine."""
    cfg = load_config()
    if 'device_id' in cfg and cfg['device_id']:
        return cfg['device_id']
    try:
        raw_id = f"{socket.gethostname()}-{platform.node()}-{uuid.getnode()}"
        dev_id = hashlib.sha256(raw_id.encode('utf-8')).hexdigest()[:16]
    except Exception:
        dev_id = str(uuid.uuid4())[:16]
    cfg['device_id'] = dev_id
    save_config(cfg)
    return dev_id

def get_device_name():
    """Returns friendly device name, e.g. Victus (Windows 11) or MacBook Pro (macOS)."""
    host = socket.gethostname() or 'AP-Merin-Device'
    os_name = 'macOS' if sys.platform == 'darwin' else ('Windows' if sys.platform == 'win32' else 'Linux')
    release = platform.release()
    return f"{host} ({os_name} {release})"

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_config(cfg):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"Warning: Could not save sync config: {e}")

def get_active_db_path():
    """
    Determines the path of the database.
    If a shared cloud folder is configured and accessible, uses that path.
    Otherwise defaults to BASE_DIR/ap_merin_data.sqlite.
    """
    cfg = load_config()
    shared_folder = cfg.get('shared_folder', '').strip()
    if shared_folder and os.path.isdir(shared_folder):
        cloud_db = os.path.join(shared_folder, DEFAULT_DB_NAME)
        local_db = os.path.join(BASE_DIR, DEFAULT_DB_NAME)
        if not os.path.exists(cloud_db) and os.path.exists(local_db):
            try:
                shutil.copy2(local_db, cloud_db)
            except Exception as e:
                print(f"Failed to copy local DB to shared folder: {e}")
        return cloud_db
    return os.path.join(BASE_DIR, DEFAULT_DB_NAME)

def get_db_connection():
    if os.environ.get('APMERIN_SHARED_MODE')=='1':
        raise RuntimeError('The web application stores shared records in Supabase; local sync storage is disabled')
    db_path = get_active_db_path()
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_database():
    """Creates necessary tables if they do not already exist."""
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute('''
    CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT,
        platform TEXT,
        last_seen TIMESTAMP,
        is_current_device INTEGER DEFAULT 0
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS comparisons (
        id TEXT PRIMARY KEY,
        subject_query TEXT,
        rfq_reference TEXT,
        customer_name TEXT,
        target_currency TEXT,
        supplier_count INTEGER DEFAULT 0,
        item_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        device_id TEXT,
        device_name TEXT,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        po_number TEXT,
        supplier_name TEXT,
        rfq_reference TEXT,
        date_issued TEXT,
        currency TEXT,
        total_amount REAL DEFAULT 0.0,
        status TEXT DEFAULT 'generated',
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        device_id TEXT,
        device_name TEXT,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS customer_quotes (
        id TEXT PRIMARY KEY,
        quote_number TEXT,
        customer_name TEXT,
        rfq_reference TEXT,
        date_issued TEXT,
        currency TEXT,
        total_amount REAL DEFAULT 0.0,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        device_id TEXT,
        device_name TEXT,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        title TEXT,
        subject TEXT,
        body_html TEXT,
        category TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        device_id TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT,
        updated_at TIMESTAMP,
        device_id TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS email_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        company TEXT,
        notes TEXT,
        frequency INTEGER DEFAULT 1,
        last_used TIMESTAMP,
        created_at TIMESTAMP,
        updated_at TIMESTAMP
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS job_cards (
        id TEXT PRIMARY KEY,
        client_name TEXT,
        client_email TEXT,
        vessel_name TEXT,
        requisition_no TEXT,
        port_location TEXT,
        current_stage TEXT DEFAULT 'rfq_received',
        priority TEXT DEFAULT 'normal',
        assigned_user_id TEXT,
        assigned_user_name TEXT,
        rfq_date TEXT,
        rfq_due_date TEXT,
        currency TEXT DEFAULT 'MYR',
        total_estimated_cost REAL DEFAULT 0.0,
        total_quoted_price REAL DEFAULT 0.0,
        total_po_value REAL DEFAULT 0.0,
        client_po_number TEXT,
        client_po_date TEXT,
        delivery_order_no TEXT,
        airway_bill_no TEXT,
        tracking_number TEXT,
        carrier_name TEXT,
        invoice_number TEXT,
        invoice_date TEXT,
        invoice_due_date TEXT,
        invoice_amount REAL DEFAULT 0.0,
        payment_status TEXT DEFAULT 'unbilled',
        payment_received_date TEXT,
        notes TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        device_id TEXT,
        device_name TEXT,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS job_card_items (
        id TEXT PRIMARY KEY,
        job_card_id TEXT NOT NULL,
        item_index INTEGER DEFAULT 0,
        item_code TEXT,
        part_no TEXT,
        maker_no TEXT,
        impa_code TEXT,
        description TEXT,
        quantity REAL DEFAULT 1.0,
        uom TEXT DEFAULT 'PCS',
        winning_supplier_id TEXT,
        winning_supplier_name TEXT,
        unit_cost REAL DEFAULT 0.0,
        cost_currency TEXT DEFAULT 'MYR',
        markup_percent REAL DEFAULT 25.0,
        unit_price REAL DEFAULT 0.0,
        total_price REAL DEFAULT 0.0,
        created_at TIMESTAMP,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS job_card_clarifications (
        id TEXT PRIMARY KEY,
        job_card_id TEXT NOT NULL,
        supplier_name TEXT,
        supplier_email TEXT,
        question TEXT,
        answer TEXT,
        status TEXT DEFAULT 'pending_answer',
        received_at TIMESTAMP,
        answered_at TIMESTAMP,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS job_card_logistics (
        id TEXT PRIMARY KEY,
        job_card_id TEXT NOT NULL,
        doc_type TEXT DEFAULT 'DO',
        doc_number TEXT,
        carrier TEXT,
        tracking_ref TEXT,
        dispatch_date TEXT,
        estimated_arrival TEXT,
        delivered_date TEXT,
        file_path TEXT,
        status TEXT DEFAULT 'in_transit',
        created_at TIMESTAMP,
        data_json TEXT
    )
    ''')

    cur.execute('''
    CREATE TABLE IF NOT EXISTS job_card_events (
        id TEXT PRIMARY KEY,
        job_card_id TEXT NOT NULL,
        event_type TEXT,
        summary TEXT,
        details TEXT,
        user_id TEXT,
        user_name TEXT,
        created_at TIMESTAMP
    )
    ''')

    cur.execute('CREATE INDEX IF NOT EXISTS idx_jc_stage ON job_cards(current_stage)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_jc_user ON job_cards(assigned_user_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_jc_payment ON job_cards(payment_status)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_jci_card ON job_card_items(job_card_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_jce_card ON job_card_events(job_card_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_jcc_card ON job_card_clarifications(job_card_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_jcl_card ON job_card_logistics(job_card_id)')

    # Seed default team & supplier contacts
    seed_default_contacts_internal(cur)

    conn.commit()
    try:
        sync_contacts_to_json()
    except Exception:
        pass

    # Register current device
    dev_id = get_machine_id()
    dev_name = get_device_name()
    plat = f"{sys.platform} ({platform.machine()})"
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    cur.execute('''
    INSERT INTO devices (device_id, device_name, platform, last_seen, is_current_device)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(device_id) DO UPDATE SET
        device_name=excluded.device_name,
        platform=excluded.platform,
        last_seen=excluded.last_seen,
        is_current_device=1
    ''', (dev_id, dev_name, plat, now))
    conn.commit()
    conn.close()

def detect_cloud_folders():
    """
    Scans common user directories for cloud storage folders (OneDrive, Google Drive,
    Dropbox, iCloud Drive) across Windows and macOS.
    """
    candidates = []
    user_home = os.path.expanduser('~')

    if sys.platform == 'win32':
        # Windows OneDrive paths
        for p in [
            os.environ.get('OneDrive'),
            os.environ.get('OneDriveCommercial'),
            os.environ.get('OneDriveConsumer'),
            os.path.join(user_home, 'OneDrive'),
        ]:
            if p and os.path.isdir(p):
                candidates.append({'type': 'onedrive', 'name': 'OneDrive', 'path': os.path.join(p, 'AP Merin Sync')})

        # Windows Google Drive paths
        for drive in ['G:', 'H:', 'F:', 'D:']:
            g_path = os.path.join(drive, '\\My Drive')
            if os.path.isdir(g_path):
                candidates.append({'type': 'googledrive', 'name': f'Google Drive ({drive})', 'path': os.path.join(g_path, 'AP Merin Sync')})
            elif os.path.isdir(drive + '\\'):
                candidates.append({'type': 'googledrive', 'name': f'Google Drive {drive}', 'path': os.path.join(drive + '\\', 'AP Merin Sync')})

        # Windows Dropbox
        db_path = os.path.join(user_home, 'Dropbox')
        if os.path.isdir(db_path):
            candidates.append({'type': 'dropbox', 'name': 'Dropbox', 'path': os.path.join(db_path, 'AP Merin Sync')})

        # Windows iCloud Drive
        ic_path = os.path.join(user_home, 'iCloudDrive')
        if os.path.isdir(ic_path):
            candidates.append({'type': 'icloud', 'name': 'iCloud Drive', 'path': os.path.join(ic_path, 'AP Merin Sync')})

    elif sys.platform == 'darwin':
        # macOS iCloud Drive
        icloud_path = os.path.join(user_home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
        if os.path.isdir(icloud_path):
            candidates.append({'type': 'icloud', 'name': 'iCloud Drive', 'path': os.path.join(icloud_path, 'AP Merin Sync')})

        # macOS Google Drive
        cloud_storage = os.path.join(user_home, 'Library', 'CloudStorage')
        if os.path.isdir(cloud_storage):
            try:
                for d in os.listdir(cloud_storage):
                    if 'GoogleDrive' in d:
                        g_full = os.path.join(cloud_storage, d, 'My Drive')
                        if os.path.isdir(g_full):
                            candidates.append({'type': 'googledrive', 'name': 'Google Drive', 'path': os.path.join(g_full, 'AP Merin Sync')})
                    elif 'OneDrive' in d:
                        o_full = os.path.join(cloud_storage, d)
                        candidates.append({'type': 'onedrive', 'name': 'OneDrive', 'path': os.path.join(o_full, 'AP Merin Sync')})
                    elif 'Dropbox' in d:
                        d_full = os.path.join(cloud_storage, d)
                        candidates.append({'type': 'dropbox', 'name': 'Dropbox', 'path': os.path.join(d_full, 'AP Merin Sync')})
            except Exception:
                pass

        # macOS standard ~/OneDrive, ~/Dropbox
        for p_name, p_type in [('OneDrive', 'onedrive'), ('Dropbox', 'dropbox')]:
            p_full = os.path.join(user_home, p_name)
            if os.path.isdir(p_full):
                candidates.append({'type': p_type, 'name': p_name, 'path': os.path.join(p_full, 'AP Merin Sync')})

    # Filter duplicates by normalized path
    unique = []
    seen = set()
    for c in candidates:
        norm = os.path.normpath(c['path']).lower()
        if norm not in seen:
            seen.add(norm)
            unique.append(c)
    return unique

def get_sync_status():
    """Returns summary of synchronization status, connected devices, and stats."""
    init_database()
    cfg = load_config()
    db_path = get_active_db_path()
    is_cloud = bool(cfg.get('shared_folder'))

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute('SELECT COUNT(*) FROM comparisons')
    comp_count = cur.fetchone()[0]

    cur.execute('SELECT COUNT(*) FROM purchase_orders')
    po_count = cur.fetchone()[0]

    cur.execute('SELECT COUNT(*) FROM customer_quotes')
    quote_count = cur.fetchone()[0]

    cur.execute('SELECT COUNT(*) FROM email_templates')
    tpl_count = cur.fetchone()[0]

    cur.execute('SELECT device_id, device_name, platform, last_seen, is_current_device FROM devices ORDER BY last_seen DESC')
    devices = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT id, subject_query, rfq_reference, customer_name, supplier_count, item_count, updated_at, device_name FROM comparisons ORDER BY updated_at DESC LIMIT 5')
    recent_comparisons = [dict(r) for r in cur.fetchall()]

    conn.close()

    return {
        'success': True,
        'current_device': {
            'id': get_machine_id(),
            'name': get_device_name(),
            'platform': sys.platform
        },
        'sync_mode': 'cloud_folder' if is_cloud else 'local',
        'db_path': db_path,
        'shared_folder': cfg.get('shared_folder', ''),
        'available_cloud_folders': detect_cloud_folders(),
        'counts': {
            'comparisons': comp_count,
            'purchase_orders': po_count,
            'customer_quotes': quote_count,
            'templates': tpl_count
        },
        'connected_devices': devices,
        'recent_comparisons': recent_comparisons,
        'last_synced_iso': datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

def configure_shared_folder(folder_path):
    """Sets or removes the shared cloud folder sync destination."""
    cfg = load_config()
    folder_path = folder_path.strip() if folder_path else ''
    if folder_path:
        os.makedirs(folder_path, exist_ok=True)
        # Seed cloud DB if not already present
        cloud_db = os.path.join(folder_path, DEFAULT_DB_NAME)
        local_db = os.path.join(BASE_DIR, DEFAULT_DB_NAME)
        if os.path.exists(local_db) and not os.path.exists(cloud_db):
            shutil.copy2(local_db, cloud_db)
        cfg['shared_folder'] = folder_path
    else:
        cfg['shared_folder'] = ''
    save_config(cfg)
    init_database()
    return get_sync_status()

# -------------------------------------------------------------------------
# COMPARISON OPERATIONS
# -------------------------------------------------------------------------
def save_comparison(data):
    """
    Saves or updates a side-by-side comparison matrix.
    data can contain:
      id, subject_query, rfq_reference, customer_name, target_currency,
      matrix, supplier_quotes, baseline_rfq, etc.
    """
    init_database()
    comp_id = data.get('id') or f"comp_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    subject = data.get('subject_query', '') or data.get('rfq_reference', '') or 'Untitled Comparison'
    rfq_ref = data.get('rfq_reference', '')
    cust_name = data.get('customer_name', '')
    currency = data.get('target_currency', 'MYR')

    supp_quotes = data.get('supplier_quotes', []) or data.get('quotes', [])
    supp_count = len(supp_quotes)
    items = data.get('items', []) or data.get('baseline_rfq', {}).get('line_items', [])
    item_count = len(items)

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    dev_id = get_machine_id()
    dev_name = get_device_name()
    data_json = json.dumps(data)

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute('''
    INSERT INTO comparisons (
        id, subject_query, rfq_reference, customer_name, target_currency,
        supplier_count, item_count, status, created_at, updated_at,
        device_id, device_name, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        subject_query=excluded.subject_query,
        rfq_reference=excluded.rfq_reference,
        customer_name=excluded.customer_name,
        target_currency=excluded.target_currency,
        supplier_count=excluded.supplier_count,
        item_count=excluded.item_count,
        updated_at=excluded.updated_at,
        device_id=excluded.device_id,
        device_name=excluded.device_name,
        data_json=excluded.data_json
    ''', (comp_id, subject, rfq_ref, cust_name, currency, supp_count, item_count, now, now, dev_id, dev_name, data_json))

    conn.commit()
    conn.close()
    return {'success': True, 'id': comp_id, 'saved_at': now}

def list_comparisons(limit=50):
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
    SELECT id, subject_query, rfq_reference, customer_name, target_currency,
           supplier_count, item_count, status, created_at, updated_at,
           device_id, device_name
    FROM comparisons
    ORDER BY updated_at DESC
    LIMIT ?
    ''', (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_comparison(comp_id):
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT * FROM comparisons WHERE id = ?', (comp_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    res = dict(row)
    if res.get('data_json'):
        try:
            res['data'] = json.loads(res['data_json'])
        except Exception:
            res['data'] = {}
    return res

def delete_comparison(comp_id):
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('DELETE FROM comparisons WHERE id = ?', (comp_id,))
    conn.commit()
    conn.close()
    return {'success': True}

# -------------------------------------------------------------------------
# PURCHASE ORDER OPERATIONS
# -------------------------------------------------------------------------
def save_purchase_order(data):
    init_database()
    po_id = data.get('id') or f"po_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    po_num = data.get('po_number', '') or po_id
    supp_name = data.get('supplier_name', '')
    rfq_ref = data.get('rfq_reference', '')
    date_iss = data.get('date_issued', '') or datetime.date.today().isoformat()
    currency = data.get('currency', 'MYR')
    tot_amt = float(data.get('total_amount', 0.0) or 0.0)

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    dev_id = get_machine_id()
    dev_name = get_device_name()
    data_json = json.dumps(data)

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
    INSERT INTO purchase_orders (
        id, po_number, supplier_name, rfq_reference, date_issued,
        currency, total_amount, status, created_at, updated_at,
        device_id, device_name, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        po_number=excluded.po_number,
        supplier_name=excluded.supplier_name,
        rfq_reference=excluded.rfq_reference,
        date_issued=excluded.date_issued,
        currency=excluded.currency,
        total_amount=excluded.total_amount,
        updated_at=excluded.updated_at,
        device_id=excluded.device_id,
        device_name=excluded.device_name,
        data_json=excluded.data_json
    ''', (po_id, po_num, supp_name, rfq_ref, date_iss, currency, tot_amt, now, now, dev_id, dev_name, data_json))
    conn.commit()
    conn.close()
    return {'success': True, 'id': po_id}

def list_purchase_orders(limit=50):
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT id, po_number, supplier_name, rfq_reference, date_issued, currency, total_amount, status, updated_at, device_name FROM purchase_orders ORDER BY updated_at DESC LIMIT ?', (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

# -------------------------------------------------------------------------
# JOB CARD OPERATIONS (FULL PROCUREMENT & ACCOUNTING LIFECYCLE)
# -------------------------------------------------------------------------
def generate_job_card_id():
    """
    Generates a sequential Job Card ID in the format JC-YY-XXXX (e.g. JC-26-0001).
    """
    init_database()
    year_suffix = datetime.datetime.now().strftime('%y')
    prefix = f"JC-{year_suffix}-"
    
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
    SELECT id FROM job_cards
    WHERE id LIKE ?
    ORDER BY id DESC LIMIT 1
    ''', (f"{prefix}%",))
    row = cur.fetchone()
    conn.close()
    
    if not row or not row['id']:
        return f"{prefix}0001"
    
    last_id = row['id']
    try:
        seq = int(last_id.split('-')[-1]) + 1
        return f"{prefix}{seq:04d}"
    except Exception:
        return f"{prefix}{uuid.uuid4().hex[:4].upper()}"

def save_job_card(data, user_id=None, user_name=None):
    """
    Creates or updates a Job Card.
    Also handles saving line items, events, and synchronizing stage.
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    card_id = data.get('id')
    is_new = False
    if not card_id or str(card_id).strip() == '':
        card_id = generate_job_card_id()
        is_new = True
    
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    created_at = data.get('created_at') or now
    updated_at = data.get('updated_at') or now
    dev_id = get_machine_id()
    dev_name = get_device_name()
    
    client_name = data.get('client_name', '')
    client_email = data.get('client_email', '')
    vessel_name = data.get('vessel_name', '')
    requisition_no = data.get('requisition_no', '')
    port_location = data.get('port_location', '')
    current_stage = data.get('current_stage', 'rfq_received')
    priority = data.get('priority', 'normal')
    assigned_user_id = data.get('assigned_user_id', '') or user_id or ''
    assigned_user_name = data.get('assigned_user_name', '') or user_name or ''
    rfq_date = data.get('rfq_date', '') or now
    rfq_due_date = data.get('rfq_due_date', '')
    currency = data.get('currency', 'MYR')
    total_estimated_cost = float(data.get('total_estimated_cost') or 0.0)
    total_quoted_price = float(data.get('total_quoted_price') or 0.0)
    total_po_value = float(data.get('total_po_value') or 0.0)
    client_po_number = data.get('client_po_number', '')
    client_po_date = data.get('client_po_date', '')
    delivery_order_no = data.get('delivery_order_no', '')
    airway_bill_no = data.get('airway_bill_no', '')
    tracking_number = data.get('tracking_number', '')
    carrier_name = data.get('carrier_name', '')
    invoice_number = data.get('invoice_number', '')
    invoice_date = data.get('invoice_date', '')
    invoice_due_date = data.get('invoice_due_date', '')
    invoice_amount = float(data.get('invoice_amount') or 0.0)
    payment_status = data.get('payment_status', 'unbilled')
    payment_received_date = data.get('payment_received_date', '')
    notes = data.get('notes', '')
    
    # Store auxiliary data as json
    data_json = json.dumps(data)
    
    cur.execute('''
    INSERT INTO job_cards (
        id, client_name, client_email, vessel_name, requisition_no, port_location,
        current_stage, priority, assigned_user_id, assigned_user_name, rfq_date,
        rfq_due_date, currency, total_estimated_cost, total_quoted_price, total_po_value,
        client_po_number, client_po_date, delivery_order_no, airway_bill_no,
        tracking_number, carrier_name, invoice_number, invoice_date, invoice_due_date,
        invoice_amount, payment_status, payment_received_date, notes, created_at,
        updated_at, device_id, device_name, data_json
    ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
        client_name=excluded.client_name,
        client_email=excluded.client_email,
        vessel_name=excluded.vessel_name,
        requisition_no=excluded.requisition_no,
        port_location=excluded.port_location,
        current_stage=excluded.current_stage,
        priority=excluded.priority,
        assigned_user_id=excluded.assigned_user_id,
        assigned_user_name=excluded.assigned_user_name,
        rfq_due_date=excluded.rfq_due_date,
        currency=excluded.currency,
        total_estimated_cost=excluded.total_estimated_cost,
        total_quoted_price=excluded.total_quoted_price,
        total_po_value=excluded.total_po_value,
        client_po_number=excluded.client_po_number,
        client_po_date=excluded.client_po_date,
        delivery_order_no=excluded.delivery_order_no,
        airway_bill_no=excluded.airway_bill_no,
        tracking_number=excluded.tracking_number,
        carrier_name=excluded.carrier_name,
        invoice_number=excluded.invoice_number,
        invoice_date=excluded.invoice_date,
        invoice_due_date=excluded.invoice_due_date,
        invoice_amount=excluded.invoice_amount,
        payment_status=excluded.payment_status,
        payment_received_date=excluded.payment_received_date,
        notes=excluded.notes,
        updated_at=excluded.updated_at,
        device_id=excluded.device_id,
        device_name=excluded.device_name,
        data_json=excluded.data_json
    ''', (
        card_id, client_name, client_email, vessel_name, requisition_no, port_location,
        current_stage, priority, assigned_user_id, assigned_user_name, rfq_date,
        rfq_due_date, currency, total_estimated_cost, total_quoted_price, total_po_value,
        client_po_number, client_po_date, delivery_order_no, airway_bill_no,
        tracking_number, carrier_name, invoice_number, invoice_date, invoice_due_date,
        invoice_amount, payment_status, payment_received_date, notes, created_at, updated_at, dev_id, dev_name, data_json
    ))
    
    # Save line items if provided
    items = data.get('items', [])
    if items:
        # Clear existing items for this card to prevent orphaned duplicates
        cur.execute('DELETE FROM job_card_items WHERE job_card_id = ?', (card_id,))
        for idx, item in enumerate(items):
            item_id = item.get('id') or f"{card_id}-ITM-{idx+1:03d}"
            cur.execute('''
            INSERT INTO job_card_items (
                id, job_card_id, item_index, item_code, part_no, maker_no, impa_code,
                description, quantity, uom, winning_supplier_id, winning_supplier_name,
                unit_cost, cost_currency, markup_percent, unit_price, total_price,
                created_at, data_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                item_id, card_id, idx,
                item.get('item_code', ''),
                item.get('part_no', ''),
                item.get('maker_no', ''),
                item.get('impa_code', ''),
                item.get('description', ''),
                float(item.get('quantity') or 1.0),
                item.get('uom', 'PCS'),
                item.get('winning_supplier_id', ''),
                item.get('winning_supplier_name', ''),
                float(item.get('unit_cost') or 0.0),
                item.get('cost_currency', currency),
                float(item.get('markup_percent') or 25.0),
                float(item.get('unit_price') or 0.0),
                float(item.get('total_price') or 0.0),
                now, json.dumps(item)
            ))

    # Add audit event
    evt_id = f"evt_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    summary = f"Job Card {card_id} created" if is_new else f"Job Card {card_id} updated (Stage: {current_stage})"
    cur.execute('''
    INSERT INTO job_card_events (
        id, job_card_id, event_type, summary, details, user_id, user_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        evt_id, card_id,
        'created' if is_new else 'updated',
        summary,
        f"Vessel: {vessel_name}, Client: {client_name}, Requisition: {requisition_no}",
        assigned_user_id, assigned_user_name, now
    ))
    
    conn.commit()
    conn.close()
    
    return {'success': True, 'id': card_id, 'card_id': card_id, 'is_new': is_new}

def get_job_card(card_id):
    """
    Fetches complete Job Card record including line items, clarifications,
    logistics records, and timeline audit events.
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM job_cards WHERE id = ?', (card_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return None
    
    card = dict(row)
    if card.get('data_json'):
        try:
            card['extra_data'] = json.loads(card['data_json'])
        except Exception:
            card['extra_data'] = {}
            
    # Fetch line items
    cur.execute('SELECT * FROM job_card_items WHERE job_card_id = ? ORDER BY item_index ASC', (card_id,))
    card['items'] = [dict(r) for r in cur.fetchall()]
    
    # Fetch clarifications
    cur.execute('SELECT * FROM job_card_clarifications WHERE job_card_id = ? ORDER BY received_at DESC', (card_id,))
    card['clarifications'] = [dict(r) for r in cur.fetchall()]
    
    # Fetch logistics records
    cur.execute('SELECT * FROM job_card_logistics WHERE job_card_id = ? ORDER BY created_at DESC', (card_id,))
    card['logistics'] = [dict(r) for r in cur.fetchall()]
    
    # Fetch audit events
    cur.execute('SELECT * FROM job_card_events WHERE job_card_id = ? ORDER BY created_at DESC', (card_id,))
    card['events'] = [dict(r) for r in cur.fetchall()]
    
    conn.close()
    return card

def list_job_cards(role=None, user_id=None, stage=None, payment_status=None, search=None, limit=200):
    """
    Lists job cards with role-aware and stage-aware filtering.
    Roles:
      - 'procurement': Focuses on operational stages (rfq to logistics).
      - 'accounting': Focuses on billing queues (invoicing, payments, aging).
      - 'admin': Complete company overview.
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    query = 'SELECT * FROM job_cards WHERE 1=1'
    params = []
    
    # Role-specific base filter
    if role == 'accounting':
        # Accounting cares about jobs ready to bill, invoiced, awaiting payment, or overdue
        query += " AND (current_stage IN ('goods_in_transit', 'goods_delivered', 'invoiced', 'payment_pending', 'paid') OR payment_status IN ('ready_to_invoice', 'invoiced', 'overdue', 'partial_paid'))"
    elif role == 'procurement' and user_id:
        # If user explicitly requested own jobs filter
        pass

    if stage and stage != 'all':
        query += ' AND current_stage = ?'
        params.append(stage)
        
    if payment_status and payment_status != 'all':
        query += ' AND payment_status = ?'
        params.append(payment_status)
        
    if search and search.strip():
        s = f"%{search.strip()}%"
        query += ' AND (id LIKE ? OR client_name LIKE ? OR vessel_name LIKE ? OR requisition_no LIKE ? OR client_po_number LIKE ? OR delivery_order_no LIKE ? OR invoice_number LIKE ?)'
        params.extend([s, s, s, s, s, s, s])
        
    query += ' ORDER BY updated_at DESC LIMIT ?'
    params.append(limit)
    
    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    
    # Attach item count & clarification count for summary views
    for r in rows:
        cid = r['id']
        cur.execute('SELECT COUNT(*) FROM job_card_items WHERE job_card_id = ?', (cid,))
        r['item_count'] = cur.fetchone()[0]
        cur.execute('SELECT COUNT(*) FROM job_card_clarifications WHERE job_card_id = ? AND status != "closed"', (cid,))
        r['pending_clarifications'] = cur.fetchone()[0]
        
    conn.close()
    return rows

def update_job_card_stage(card_id, new_stage, user_id=None, user_name=None, note=None):
    """
    Updates the stage of a Job Card and creates an audit timeline entry.
    Handles stage-dependent triggers (e.g. setting payment_status='ready_to_invoice' when goods delivered).
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute('SELECT current_stage, payment_status FROM job_cards WHERE id = ?', (card_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return {'success': False, 'error': f'Job Card {card_id} not found'}
        
    old_stage = row['current_stage']
    old_payment = row['payment_status']
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    dev_id = get_machine_id()
    dev_name = get_device_name()
    
    # Trigger payment status update if delivery is completed
    new_payment = old_payment
    if new_stage in ('goods_in_transit', 'goods_delivered') and old_payment == 'unbilled':
        new_payment = 'ready_to_invoice'
    elif new_stage == 'invoiced' and old_payment in ('unbilled', 'ready_to_invoice'):
        new_payment = 'invoiced'
    elif new_stage == 'paid':
        new_payment = 'paid'
        
    cur.execute('''
    UPDATE job_cards
    SET current_stage = ?, payment_status = ?, updated_at = ?, device_id = ?, device_name = ?
    WHERE id = ?
    ''', (new_stage, new_payment, now, dev_id, dev_name, card_id))
    
    # Audit event
    evt_id = f"evt_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    summary = f"Stage transitioned: {old_stage} -> {new_stage}"
    details = f"User note: {note}" if note else f"Updated by {user_name or 'System'}"
    cur.execute('''
    INSERT INTO job_card_events (
        id, job_card_id, event_type, summary, details, user_id, user_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (evt_id, card_id, 'stage_change', summary, details, user_id or '', user_name or '', now))
    
    conn.commit()
    conn.close()
    return {'success': True, 'card_id': card_id, 'old_stage': old_stage, 'new_stage': new_stage}

def add_job_card_event(card_id, event_type, summary, details='', user_id='', user_name=''):
    """Adds a persistent audit log event to a Job Card."""
    init_database()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    evt_id = f"evt_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
    INSERT INTO job_card_events (
        id, job_card_id, event_type, summary, details, user_id, user_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (evt_id, card_id, event_type, summary, details, user_id, user_name, now))
    conn.commit()
    conn.close()
    return {'success': True, 'event_id': evt_id}

def save_job_card_clarification(data, user_id='', user_name=''):
    """
    Saves a supplier technical question or clarification and its answer.
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    cid = data.get('id') or f"clarif_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    job_card_id = data.get('job_card_id')
    supp_name = data.get('supplier_name', '')
    supp_email = data.get('supplier_email', '')
    question = data.get('question', '')
    answer = data.get('answer', '')
    status = data.get('status', 'pending_answer')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rec_at = data.get('received_at') or now
    
    cur.execute('''
    INSERT INTO job_card_clarifications (
        id, job_card_id, supplier_name, supplier_email, question, answer, status, received_at, answered_at, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        question=excluded.question,
        answer=excluded.answer,
        status=excluded.status,
        answered_at=excluded.answered_at,
        data_json=excluded.data_json
    ''', (cid, job_card_id, supp_name, supp_email, question, answer, status, rec_at, now if answer else None, json.dumps(data)))
    
    # Flag job card as having pending clarification if not answered
    if status != 'closed':
        cur.execute('''
        UPDATE job_cards
        SET current_stage = CASE WHEN current_stage IN ('rfq_received', 'rfq_broadcast', 'quotes_received') THEN 'clarification_pending' ELSE current_stage END,
            updated_at = ?
        WHERE id = ?
        ''', (now, job_card_id))
        
    conn.commit()
    conn.close()
    
    add_job_card_event(job_card_id, 'clarification', f"Clarification from {supp_name}: {question[:60]}...", details=answer, user_id=user_id, user_name=user_name)
    return {'success': True, 'id': cid}

def save_job_card_logistics(data, user_id='', user_name=''):
    """
    Records a Delivery Order (DO), Airway Bill (AWB), or Bill of Lading (BL).
    Auto-updates Job Card logistics fields and transitions stage to 'goods_in_transit' or 'goods_delivered'.
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    lid = data.get('id') or f"log_{int(datetime.datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    job_card_id = data.get('job_card_id')
    doc_type = data.get('doc_type', 'DO')
    doc_number = data.get('doc_number', '')
    carrier = data.get('carrier', '')
    tracking_ref = data.get('tracking_ref', '')
    dispatch_date = data.get('dispatch_date', '')
    estimated_arrival = data.get('estimated_arrival', '')
    delivered_date = data.get('delivered_date', '')
    file_path = data.get('file_path', '')
    status = data.get('status', 'in_transit')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    cur.execute('''
    INSERT INTO job_card_logistics (
        id, job_card_id, doc_type, doc_number, carrier, tracking_ref, dispatch_date,
        estimated_arrival, delivered_date, file_path, status, created_at, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        doc_type=excluded.doc_type,
        doc_number=excluded.doc_number,
        carrier=excluded.carrier,
        tracking_ref=excluded.tracking_ref,
        dispatch_date=excluded.dispatch_date,
        estimated_arrival=excluded.estimated_arrival,
        delivered_date=excluded.delivered_date,
        file_path=excluded.file_path,
        status=excluded.status,
        data_json=excluded.data_json
    ''', (lid, job_card_id, doc_type, doc_number, carrier, tracking_ref, dispatch_date, estimated_arrival, delivered_date, file_path, status, now, json.dumps(data)))
    
    # Synchronize Job Card top-level fields
    stage_update = 'goods_delivered' if delivered_date or status == 'delivered' else 'goods_in_transit'
    cur.execute('''
    UPDATE job_cards
    SET current_stage = ?,
        delivery_order_no = CASE WHEN ? = 'DO' THEN ? ELSE delivery_order_no END,
        airway_bill_no = CASE WHEN ? IN ('AWB', 'BL') THEN ? ELSE airway_bill_no END,
        carrier_name = COALESCE(NULLIF(?, ''), carrier_name),
        tracking_number = COALESCE(NULLIF(?, ''), tracking_number),
        payment_status = 'ready_to_invoice',
        updated_at = ?
    WHERE id = ?
    ''', (stage_update, doc_type, doc_number, doc_type, doc_number, carrier, tracking_ref, now, job_card_id))
    
    conn.commit()
    conn.close()
    
    add_job_card_event(job_card_id, 'logistics', f"{doc_type} #{doc_number} recorded ({status})", details=f"Carrier: {carrier}, Tracking: {tracking_ref}", user_id=user_id, user_name=user_name)
    return {'success': True, 'id': lid}

def get_accounting_invoicing_queue(filter_type=None):
    """
    Fetches structured queues specifically tailored for the Accounting user:
      1. ready_to_invoice: Jobs with verified PO + DO/AWB, awaiting invoice issuance.
      2. invoiced: Active invoices awaiting client payment (with live aging calculations).
      3. settled: Completed & fully paid jobs.
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    # 1. Ready to invoice (Client PO exists and DO/AWB received or goods in transit/delivered)
    cur.execute('''
    SELECT * FROM job_cards
    WHERE payment_status = 'ready_to_invoice'
       OR (invoice_number IS NULL OR invoice_number = '') AND current_stage IN ('goods_in_transit', 'goods_delivered', 'supplier_po_sent')
    ORDER BY updated_at DESC
    ''')
    ready_to_invoice = [dict(r) for r in cur.fetchall()]
    
    # 2. Invoiced / Awaiting Payment
    cur.execute('''
    SELECT * FROM job_cards
    WHERE invoice_number IS NOT NULL AND invoice_number != ''
      AND payment_status IN ('invoiced', 'partial_paid', 'overdue')
    ORDER BY invoice_date DESC
    ''')
    invoiced_rows = [dict(r) for r in cur.fetchall()]
    
    # Calculate live aging for each invoiced job
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    invoiced = []
    overdue_count = 0
    total_unpaid_myr = 0.0
    
    for row in invoiced_rows:
        inv_date_str = row.get('invoice_date') or ''
        due_date_str = row.get('invoice_due_date') or ''
        aging_days = 0
        is_overdue = False
        
        try:
            if inv_date_str:
                clean_inv = inv_date_str[:10]
                dt_inv = datetime.datetime.strptime(clean_inv, '%Y-%m-%d').replace(tzinfo=datetime.timezone.utc)
                aging_days = (now_dt - dt_inv).days
        except Exception:
            pass
            
        try:
            if due_date_str:
                clean_due = due_date_str[:10]
                dt_due = datetime.datetime.strptime(clean_due, '%Y-%m-%d').replace(tzinfo=datetime.timezone.utc)
                if now_dt > dt_due:
                    is_overdue = True
                    overdue_count += 1
        except Exception:
            pass
            
        row['aging_days'] = max(0, aging_days)
        row['is_overdue'] = is_overdue
        row['aging_category'] = '0-30 days' if aging_days <= 30 else ('31-60 days' if aging_days <= 60 else '60+ days')
        
        amt = float(row.get('invoice_amount') or row.get('total_po_value') or row.get('total_quoted_price') or 0.0)
        total_unpaid_myr += amt
        invoiced.append(row)
        
    # 3. Settled / Paid
    cur.execute('''
    SELECT * FROM job_cards
    WHERE payment_status = 'paid' OR current_stage = 'paid'
    ORDER BY updated_at DESC LIMIT 50
    ''')
    settled = [dict(r) for r in cur.fetchall()]
    
    conn.close()
    
    return {
        'ready_to_invoice': ready_to_invoice,
        'ready_count': len(ready_to_invoice),
        'invoiced': invoiced,
        'invoiced_count': len(invoiced),
        'overdue_count': overdue_count,
        'total_unpaid_amount': total_unpaid_myr,
        'settled': settled,
        'settled_count': len(settled)
    }

def record_invoice_issued(card_id, invoice_number, invoice_date, due_date, invoice_amount, user_id='', user_name=''):
    """
    Called when Accounting issues an invoice (or detected via outgoing invoice email).
    Updates Job Card billing information and changes stage to 'invoiced'.
    """
    init_database()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute('''
    UPDATE job_cards
    SET invoice_number = ?,
        invoice_date = ?,
        invoice_due_date = ?,
        invoice_amount = ?,
        payment_status = 'invoiced',
        current_stage = 'invoiced',
        updated_at = ?
    WHERE id = ?
    ''', (invoice_number, invoice_date, due_date, float(invoice_amount or 0.0), now, card_id))
    
    conn.commit()
    conn.close()
    
    add_job_card_event(card_id, 'invoice_issued', f"Invoice #{invoice_number} issued for amount {invoice_amount}", details=f"Due Date: {due_date}", user_id=user_id, user_name=user_name)
    return {'success': True, 'card_id': card_id, 'invoice_number': invoice_number}

def record_invoice_payment(card_id, payment_amount, payment_date, payment_status='paid', reference='', user_id='', user_name=''):
    """
    Records customer payment receipt on a Job Card.
    """
    init_database()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    conn = get_db_connection()
    cur = conn.cursor()
    
    stage = 'paid' if payment_status == 'paid' else 'payment_pending'
    cur.execute('''
    UPDATE job_cards
    SET payment_status = ?,
        payment_received_date = ?,
        current_stage = ?,
        updated_at = ?
    WHERE id = ?
    ''', (payment_status, payment_date or now, stage, now, card_id))
    
    conn.commit()
    conn.close()
    
    add_job_card_event(card_id, 'payment_received', f"Payment of {payment_amount} received (Status: {payment_status})", details=f"Ref: {reference}", user_id=user_id, user_name=user_name)
    return {'success': True, 'card_id': card_id, 'payment_status': payment_status}

def delete_job_card(card_id):
    """Permanently deletes a Job Card and all its associated child records."""
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('DELETE FROM job_cards WHERE id = ?', (card_id,))
    cur.execute('DELETE FROM job_card_items WHERE job_card_id = ?', (card_id,))
    cur.execute('DELETE FROM job_card_clarifications WHERE job_card_id = ?', (card_id,))
    cur.execute('DELETE FROM job_card_logistics WHERE job_card_id = ?', (card_id,))
    cur.execute('DELETE FROM job_card_events WHERE job_card_id = ?', (card_id,))
    conn.commit()
    conn.close()
    return {'success': True, 'deleted_id': card_id}

# -------------------------------------------------------------------------
# PROACTIVE JOB STATUS & REMINDER ENGINE
# -------------------------------------------------------------------------
def get_active_reminders(user_id=None, role=None):
    """
    Computes active real-time operational and billing reminders across all active Job Cards.
    Zero token cost: runs locally on SQLite timestamps and datetime calculations.
    Returns:
      - reminders: list of active reminder objects
      - counts: dict of counts by priority ('critical', 'urgent', 'warning', 'info')
      - total_count: total active reminders
    """
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()
    
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    reminders = []
    
    # 1. PENDING SUPPLIER CLARIFICATIONS
    # Supplier asked for vessel details, datasheet, serial numbers, drawings
    cur.execute('''
    SELECT c.id, c.job_card_id, c.supplier_name, c.supplier_email, c.question, c.status, c.received_at,
           j.vessel_name, j.client_name, j.requisition_no, j.assigned_user_id, j.assigned_user_name
    FROM job_card_clarifications c
    JOIN job_cards j ON c.job_card_id = j.id
    WHERE c.status != 'closed' AND (c.answer IS NULL OR c.answer = '')
    ORDER BY c.received_at ASC
    ''')
    for row in cur.fetchall():
        r = dict(row)
        rec_str = r.get('received_at') or ''
        hours_waiting = 0
        try:
            if rec_str:
                dt_rec = datetime.datetime.fromisoformat(rec_str.replace('Z', '+00:00'))
                hours_waiting = int((now_dt - dt_rec).total_seconds() / 3600)
        except Exception:
            pass
            
        prio = 'critical' if hours_waiting >= 24 else ('urgent' if hours_waiting >= 12 else 'warning')
        q_snippet = (r.get('question') or 'Supplier requested technical clarification')[:100]
        reminders.append({
            'id': f"rem_clarif_{r['id']}",
            'type': 'clarification',
            'priority': prio,
            'job_card_id': r['job_card_id'],
            'vessel_name': r['vessel_name'],
            'client_name': r['client_name'],
            'requisition_no': r['requisition_no'],
            'title': f"Supplier Clarification Needed ({r['supplier_name']})",
            'message': f"Question: \"{q_snippet}\" - Waiting for {hours_waiting}h",
            'action_type': 'reply_clarification',
            'action_label': 'Reply / Forward to Client',
            'hours_elapsed': hours_waiting,
            'supplier_name': r['supplier_name'],
            'supplier_email': r['supplier_email'],
            'question': r['question'],
            'assigned_user_id': r['assigned_user_id'],
            'for_roles': ['procurement', 'admin']
        })

    # 2. SUPPLIER LEAD TIME APPROACHING & DELIVERY CHASER
    # PO sent to supplier, but no DO or AWB received and delivery date is near or overdue
    cur.execute('''
    SELECT id, vessel_name, client_name, requisition_no, client_po_number, client_po_date,
           current_stage, updated_at, assigned_user_id, assigned_user_name, delivery_order_no,
           airway_bill_no, rfq_due_date, data_json
    FROM job_cards
    WHERE current_stage = 'supplier_po_sent'
      AND (delivery_order_no IS NULL OR delivery_order_no = '')
      AND (airway_bill_no IS NULL OR airway_bill_no = '')
    ''')
    for row in cur.fetchall():
        r = dict(row)
        upd_str = r.get('updated_at') or ''
        days_waiting = 0
        try:
            if upd_str:
                dt_upd = datetime.datetime.fromisoformat(upd_str.replace('Z', '+00:00'))
                days_waiting = (now_dt - dt_upd).days
        except Exception:
            pass
            
        if days_waiting >= 2:
            prio = 'critical' if days_waiting >= 5 else 'urgent'
            reminders.append({
                'id': f"rem_lead_{r['id']}",
                'type': 'lead_time',
                'priority': prio,
                'job_card_id': r['id'],
                'vessel_name': r['vessel_name'],
                'client_name': r['client_name'],
                'requisition_no': r['requisition_no'],
                'title': f"Lead Time Alert: No Dispatch Update",
                'message': f"Supplier PO dispatched {days_waiting} days ago for {r['vessel_name']}. No DO or Airway Bill received.",
                'action_type': 'chase_supplier_delivery',
                'action_label': 'Send Supplier Delivery Chaser',
                'days_elapsed': days_waiting,
                'assigned_user_id': r['assigned_user_id'],
                'for_roles': ['procurement', 'admin']
            })

    # 3. AWAITING SUPPLIER QUOTES OVERDUE
    # Sourcing RFQ broadcasted > 24h ago
    cur.execute('''
    SELECT id, vessel_name, client_name, requisition_no, updated_at, assigned_user_id
    FROM job_cards
    WHERE current_stage = 'rfq_broadcast'
    ''')
    for row in cur.fetchall():
        r = dict(row)
        upd_str = r.get('updated_at') or ''
        hours_waiting = 0
        try:
            if upd_str:
                dt_upd = datetime.datetime.fromisoformat(upd_str.replace('Z', '+00:00'))
                hours_waiting = int((now_dt - dt_upd).total_seconds() / 3600)
        except Exception:
            pass
        if hours_waiting >= 24:
            reminders.append({
                'id': f"rem_rfq_{r['id']}",
                'type': 'rfq_overdue',
                'priority': 'warning',
                'job_card_id': r['id'],
                'vessel_name': r['vessel_name'],
                'client_name': r['client_name'],
                'requisition_no': r['requisition_no'],
                'title': f"Supplier Quotes Pending (>24h)",
                'message': f"RFQ broadcasted {hours_waiting}h ago for {r['vessel_name']}. Supplier quotes pending.",
                'action_type': 'chase_supplier_quote',
                'action_label': 'Send RFQ Reminder',
                'hours_elapsed': hours_waiting,
                'assigned_user_id': r['assigned_user_id'],
                'for_roles': ['procurement', 'admin']
            })

    # 4. CLIENT QUOTE SENT - AWAITING CLIENT PO (>3 DAYS)
    cur.execute('''
    SELECT id, vessel_name, client_name, requisition_no, updated_at, total_quoted_price, currency, assigned_user_id
    FROM job_cards
    WHERE current_stage = 'client_quote_sent'
    ''')
    for row in cur.fetchall():
        r = dict(row)
        upd_str = r.get('updated_at') or ''
        days_waiting = 0
        try:
            if upd_str:
                dt_upd = datetime.datetime.fromisoformat(upd_str.replace('Z', '+00:00'))
                days_waiting = (now_dt - dt_upd).days
        except Exception:
            pass
        if days_waiting >= 3:
            reminders.append({
                'id': f"rem_client_po_{r['id']}",
                'type': 'quote_pending_po',
                'priority': 'info',
                'job_card_id': r['id'],
                'vessel_name': r['vessel_name'],
                'client_name': r['client_name'],
                'requisition_no': r['requisition_no'],
                'title': f"Quotation Sent {days_waiting} Days Ago",
                'message': f"Quoted {r['currency']} {float(r['total_quoted_price'] or 0):,.2f} to {r['client_name']}. Follow up on Purchase Order.",
                'action_type': 'followup_client_quote',
                'action_label': 'Follow Up with Client',
                'days_elapsed': days_waiting,
                'assigned_user_id': r['assigned_user_id'],
                'for_roles': ['procurement', 'admin']
            })

    # 5. LOGISTICS IN TRANSIT - CONFIRM ARRIVAL (>2 DAYS)
    cur.execute('''
    SELECT id, vessel_name, client_name, requisition_no, updated_at, airway_bill_no, delivery_order_no, carrier_name, assigned_user_id
    FROM job_cards
    WHERE current_stage = 'goods_in_transit'
    ''')
    for row in cur.fetchall():
        r = dict(row)
        upd_str = r.get('updated_at') or ''
        days_waiting = 0
        try:
            if upd_str:
                dt_upd = datetime.datetime.fromisoformat(upd_str.replace('Z', '+00:00'))
                days_waiting = (now_dt - dt_upd).days
        except Exception:
            pass
        if days_waiting >= 2:
            reminders.append({
                'id': f"rem_transit_{r['id']}",
                'type': 'logistics_in_transit',
                'priority': 'urgent',
                'job_card_id': r['id'],
                'vessel_name': r['vessel_name'],
                'client_name': r['client_name'],
                'requisition_no': r['requisition_no'],
                'title': f"Confirm Delivery Arrival",
                'message': f"Goods in transit {days_waiting} days for {r['vessel_name']} (AWB/DO: {r['airway_bill_no'] or r['delivery_order_no'] or 'N/A'}). Confirm delivery.",
                'action_type': 'confirm_delivery',
                'action_label': 'Mark as Delivered',
                'days_elapsed': days_waiting,
                'assigned_user_id': r['assigned_user_id'],
                'for_roles': ['procurement', 'admin']
            })

    # 6. ACCOUNTING: READY FOR INVOICE ISSUANCE
    cur.execute('''
    SELECT id, vessel_name, client_name, requisition_no, client_po_number, total_po_value, currency, updated_at
    FROM job_cards
    WHERE payment_status = 'ready_to_invoice'
       OR ((invoice_number IS NULL OR invoice_number = '') AND current_stage IN ('goods_delivered', 'goods_in_transit'))
    ''')
    for row in cur.fetchall():
        r = dict(row)
        reminders.append({
            'id': f"rem_inv_{r['id']}",
            'type': 'ready_to_invoice',
            'priority': 'urgent',
            'job_card_id': r['id'],
            'vessel_name': r['vessel_name'],
            'client_name': r['client_name'],
            'requisition_no': r['requisition_no'],
            'title': f"Ready for Invoicing",
            'message': f"Delivery verified for {r['vessel_name']} ({r['client_name']}). Client PO #{r['client_po_number'] or 'N/A'}. Issue sales invoice.",
            'action_type': 'issue_invoice',
            'action_label': 'Log Invoice Issued',
            'for_roles': ['accounting', 'admin']
        })

    # 7. ACCOUNTING: CLIENT PAYMENT OVERDUE
    cur.execute('''
    SELECT id, vessel_name, client_name, invoice_number, invoice_date, invoice_due_date, invoice_amount, currency
    FROM job_cards
    WHERE invoice_number IS NOT NULL AND invoice_number != ''
      AND payment_status IN ('invoiced', 'partial_paid', 'overdue')
    ''')
    for row in cur.fetchall():
        r = dict(row)
        due_str = r.get('invoice_due_date') or ''
        is_overdue = False
        overdue_days = 0
        try:
            if due_str:
                dt_due = datetime.datetime.strptime(due_str[:10], '%Y-%m-%d').replace(tzinfo=datetime.timezone.utc)
                if now_dt > dt_due:
                    is_overdue = True
                    overdue_days = (now_dt - dt_due).days
        except Exception:
            pass
        if is_overdue:
            reminders.append({
                'id': f"rem_pay_{r['id']}",
                'type': 'payment_overdue',
                'priority': 'critical',
                'job_card_id': r['id'],
                'vessel_name': r['vessel_name'],
                'client_name': r['client_name'],
                'title': f"Payment Overdue ({overdue_days} Days)",
                'message': f"Invoice #{r['invoice_number']} for {r['client_name']} ({r['currency']} {float(r['invoice_amount'] or 0):,.2f}) is {overdue_days} days past due.",
                'action_type': 'chase_payment',
                'action_label': 'Send Payment Reminder',
                'days_elapsed': overdue_days,
                'for_roles': ['accounting', 'admin']
            })

    conn.close()

    # Filter by user role if requested
    if role:
        filtered = [rem for rem in reminders if role in rem['for_roles'] or role == 'admin']
    else:
        filtered = reminders

    # Count by priority
    counts = {'critical': 0, 'urgent': 0, 'warning': 0, 'info': 0}
    for rem in filtered:
        p = rem.get('priority', 'info')
        if p in counts:
            counts[p] += 1

    return {
        'reminders': filtered,
        'counts': counts,
        'total_count': len(filtered)
    }

# -------------------------------------------------------------------------
# ONE-CLICK EXPORT / IMPORT SYNC BUNDLE
# -------------------------------------------------------------------------
def export_sync_bundle():
    """Exports all comparisons, POs, customer quotes, settings, and templates into a portable JSON bundle."""
    init_database()
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute('SELECT * FROM comparisons')
    comps = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM purchase_orders')
    pos = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM customer_quotes')
    quotes = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM email_templates')
    tpls = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM app_settings')
    settings = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM job_cards')
    jcs = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM job_card_items')
    jcis = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM job_card_clarifications')
    jccs = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM job_card_logistics')
    jcls = [dict(r) for r in cur.fetchall()]

    cur.execute('SELECT * FROM job_card_events')
    jces = [dict(r) for r in cur.fetchall()]

    conn.close()

    bundle = {
        'format_version': '1.0',
        'export_timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source_device': {
            'id': get_machine_id(),
            'name': get_device_name(),
            'platform': sys.platform
        },
        'data': {
            'comparisons': comps,
            'purchase_orders': pos,
            'customer_quotes': quotes,
            'email_templates': tpls,
            'app_settings': settings,
            'job_cards': jcs,
            'job_card_items': jcis,
            'job_card_clarifications': jccs,
            'job_card_logistics': jcls,
            'job_card_events': jces
        }
    }
    return bundle

def import_sync_bundle(bundle_dict):
    """
    Merges an imported sync bundle into the local/shared database.
    Performs upserts (updates record if imported updated_at is newer or record doesn't exist).
    """
    init_database()
    data = bundle_dict.get('data', {})
    conn = get_db_connection()
    cur = conn.cursor()
    imported_counts = {
        'comparisons': 0, 'purchase_orders': 0, 'customer_quotes': 0,
        'email_templates': 0, 'job_cards': 0, 'job_card_items': 0,
        'job_card_clarifications': 0, 'job_card_logistics': 0, 'job_card_events': 0
    }

    # 1. Comparisons
    for c in data.get('comparisons', []):
        try:
            cur.execute('''
            INSERT INTO comparisons (id, subject_query, rfq_reference, customer_name, target_currency, supplier_count, item_count, status, created_at, updated_at, device_id, device_name, data_json)
            VALUES (:id, :subject_query, :rfq_reference, :customer_name, :target_currency, :supplier_count, :item_count, :status, :created_at, :updated_at, :device_id, :device_name, :data_json)
            ON CONFLICT(id) DO UPDATE SET
                subject_query=excluded.subject_query,
                rfq_reference=excluded.rfq_reference,
                customer_name=excluded.customer_name,
                target_currency=excluded.target_currency,
                supplier_count=excluded.supplier_count,
                item_count=excluded.item_count,
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                device_name=excluded.device_name,
                data_json=excluded.data_json
            WHERE excluded.updated_at >= comparisons.updated_at
            ''', c)
            imported_counts['comparisons'] += 1
        except Exception as e:
            print(f"Import error for comparison {c.get('id')}: {e}")

    # 2. Purchase orders
    for po in data.get('purchase_orders', []):
        try:
            cur.execute('''
            INSERT INTO purchase_orders (id, po_number, supplier_name, rfq_reference, date_issued, currency, total_amount, status, created_at, updated_at, device_id, device_name, data_json)
            VALUES (:id, :po_number, :supplier_name, :rfq_reference, :date_issued, :currency, :total_amount, :status, :created_at, :updated_at, :device_id, :device_name, :data_json)
            ON CONFLICT(id) DO UPDATE SET
                po_number=excluded.po_number,
                supplier_name=excluded.supplier_name,
                rfq_reference=excluded.rfq_reference,
                date_issued=excluded.date_issued,
                currency=excluded.currency,
                total_amount=excluded.total_amount,
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                device_name=excluded.device_name,
                data_json=excluded.data_json
            WHERE excluded.updated_at >= purchase_orders.updated_at
            ''', po)
            imported_counts['purchase_orders'] += 1
        except Exception as e:
            print(f"Import error for PO {po.get('id')}: {e}")

    # 3. Job Cards
    for jc in data.get('job_cards', []):
        try:
            cur.execute('''
            INSERT INTO job_cards (
                id, client_name, client_email, vessel_name, requisition_no, port_location,
                current_stage, priority, assigned_user_id, assigned_user_name, rfq_date,
                rfq_due_date, currency, total_estimated_cost, total_quoted_price, total_po_value,
                client_po_number, client_po_date, delivery_order_no, airway_bill_no,
                tracking_number, carrier_name, invoice_number, invoice_date, invoice_due_date,
                invoice_amount, payment_status, payment_received_date, notes, created_at,
                updated_at, device_id, device_name, data_json
            ) VALUES (
                :id, :client_name, :client_email, :vessel_name, :requisition_no, :port_location,
                :current_stage, :priority, :assigned_user_id, :assigned_user_name, :rfq_date,
                :rfq_due_date, :currency, :total_estimated_cost, :total_quoted_price, :total_po_value,
                :client_po_number, :client_po_date, :delivery_order_no, :airway_bill_no,
                :tracking_number, :carrier_name, :invoice_number, :invoice_date, :invoice_due_date,
                :invoice_amount, :payment_status, :payment_received_date, :notes, :created_at,
                :updated_at, :device_id, :device_name, :data_json
            )
            ON CONFLICT(id) DO UPDATE SET
                client_name=excluded.client_name,
                client_email=excluded.client_email,
                vessel_name=excluded.vessel_name,
                requisition_no=excluded.requisition_no,
                port_location=excluded.port_location,
                current_stage=excluded.current_stage,
                priority=excluded.priority,
                assigned_user_id=excluded.assigned_user_id,
                assigned_user_name=excluded.assigned_user_name,
                rfq_due_date=excluded.rfq_due_date,
                currency=excluded.currency,
                total_estimated_cost=excluded.total_estimated_cost,
                total_quoted_price=excluded.total_quoted_price,
                total_po_value=excluded.total_po_value,
                client_po_number=excluded.client_po_number,
                client_po_date=excluded.client_po_date,
                delivery_order_no=excluded.delivery_order_no,
                airway_bill_no=excluded.airway_bill_no,
                tracking_number=excluded.tracking_number,
                carrier_name=excluded.carrier_name,
                invoice_number=excluded.invoice_number,
                invoice_date=excluded.invoice_date,
                invoice_due_date=excluded.invoice_due_date,
                invoice_amount=excluded.invoice_amount,
                payment_status=excluded.payment_status,
                payment_received_date=excluded.payment_received_date,
                notes=excluded.notes,
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                device_name=excluded.device_name,
                data_json=excluded.data_json
            WHERE excluded.updated_at >= job_cards.updated_at
            ''', jc)
            imported_counts['job_cards'] += 1
        except Exception as e:
            print(f"Import error for Job Card {jc.get('id')}: {e}")

    # 4. Job Card Items
    for item in data.get('job_card_items', []):
        try:
            cur.execute('''
            INSERT INTO job_card_items (
                id, job_card_id, item_index, item_code, part_no, maker_no, impa_code,
                description, quantity, uom, winning_supplier_id, winning_supplier_name,
                unit_cost, cost_currency, markup_percent, unit_price, total_price,
                created_at, data_json
            ) VALUES (
                :id, :job_card_id, :item_index, :item_code, :part_no, :maker_no, :impa_code,
                :description, :quantity, :uom, :winning_supplier_id, :winning_supplier_name,
                :unit_cost, :cost_currency, :markup_percent, :unit_price, :total_price,
                :created_at, :data_json
            )
            ON CONFLICT(id) DO UPDATE SET
                item_code=excluded.item_code,
                part_no=excluded.part_no,
                maker_no=excluded.maker_no,
                impa_code=excluded.impa_code,
                description=excluded.description,
                quantity=excluded.quantity,
                uom=excluded.uom,
                winning_supplier_id=excluded.winning_supplier_id,
                winning_supplier_name=excluded.winning_supplier_name,
                unit_cost=excluded.unit_cost,
                cost_currency=excluded.cost_currency,
                markup_percent=excluded.markup_percent,
                unit_price=excluded.unit_price,
                total_price=excluded.total_price,
                data_json=excluded.data_json
            ''', item)
            imported_counts['job_card_items'] += 1
        except Exception as e:
            print(f"Import error for Job Card Item {item.get('id')}: {e}")

    # 5. Clarifications, Logistics, Events
    for clarif in data.get('job_card_clarifications', []):
        try:
            cur.execute('''
            INSERT INTO job_card_clarifications (id, job_card_id, supplier_name, supplier_email, question, answer, status, received_at, answered_at, data_json)
            VALUES (:id, :job_card_id, :supplier_name, :supplier_email, :question, :answer, :status, :received_at, :answered_at, :data_json)
            ON CONFLICT(id) DO UPDATE SET
                question=excluded.question, answer=excluded.answer, status=excluded.status, answered_at=excluded.answered_at, data_json=excluded.data_json
            ''', clarif)
            imported_counts['job_card_clarifications'] += 1
        except Exception as e:
            print(f"Import error for Clarification {clarif.get('id')}: {e}")

    for log_rec in data.get('job_card_logistics', []):
        try:
            cur.execute('''
            INSERT INTO job_card_logistics (id, job_card_id, doc_type, doc_number, carrier, tracking_ref, dispatch_date, estimated_arrival, delivered_date, file_path, status, created_at, data_json)
            VALUES (:id, :job_card_id, :doc_type, :doc_number, :carrier, :tracking_ref, :dispatch_date, :estimated_arrival, :delivered_date, :file_path, :status, :created_at, :data_json)
            ON CONFLICT(id) DO UPDATE SET
                doc_type=excluded.doc_type, doc_number=excluded.doc_number, carrier=excluded.carrier, tracking_ref=excluded.tracking_ref, status=excluded.status, delivered_date=excluded.delivered_date
            ''', log_rec)
            imported_counts['job_card_logistics'] += 1
        except Exception as e:
            print(f"Import error for Logistics {log_rec.get('id')}: {e}")

    for evt in data.get('job_card_events', []):
        try:
            cur.execute('''
            INSERT OR IGNORE INTO job_card_events (id, job_card_id, event_type, summary, details, user_id, user_name, created_at)
            VALUES (:id, :job_card_id, :event_type, :summary, :details, :user_id, :user_name, :created_at)
            ''', evt)
            imported_counts['job_card_events'] += 1
        except Exception as e:
            pass

    conn.commit()
    conn.close()
    return {'success': True, 'imported': imported_counts}

# =========================================================================
# USER PROFILES & DESIGNATED SIGNATURES PERSISTENCE ENGINE
# =========================================================================
PROFILES_FILE = os.path.join(BASE_DIR, 'ap_merin_user_profiles.json')

def save_app_setting(key, value):
    """Saves a key-value setting into SQLite app_settings table."""
    try:
        init_database()
        conn = get_db_connection()
        cur = conn.cursor()
        dev_id = get_machine_id()
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        cur.execute('''
        INSERT INTO app_settings (setting_key, setting_value, updated_at, device_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
            setting_value=excluded.setting_value,
            updated_at=excluded.updated_at,
            device_id=excluded.device_id
        ''', (key, str(value) if value is not None else '', now, dev_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Error saving app setting {key}: {e}")
        return False

def get_app_setting(key, default=None):
    """Retrieves a setting value from SQLite app_settings table."""
    try:
        init_database()
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT setting_value FROM app_settings WHERE setting_key = ?', (key,))
        row = cur.fetchone()
        conn.close()
        if row and row['setting_value'] is not None:
            return row['setting_value']
        return default
    except Exception as e:
        print(f"Error getting app setting {key}: {e}")
        return default

def save_user_profiles_bundle(users=None, admin=None, active_user_id=None):
    """
    Saves users, admin, and active_user_id both into SQLite app_settings AND
    into ap_merin_user_profiles.json for permanent dual-persistence.
    """
    bundle = {}
    if os.path.exists(PROFILES_FILE):
        try:
            with open(PROFILES_FILE, 'r', encoding='utf-8') as f:
                bundle = json.load(f)
        except Exception:
            bundle = {}
    
    if users is not None:
        bundle['users'] = users
        save_app_setting('system_users', json.dumps(users))
    if admin is not None:
        bundle['admin'] = admin
        save_app_setting('admin_user', json.dumps(admin))
    if active_user_id is not None:
        bundle['active_user_id'] = active_user_id
        save_app_setting('active_user_id', str(active_user_id))
        
    bundle['updated_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    bundle['device_id'] = get_machine_id()
    
    # 1. Save to primary persistent data directory
    try:
        with open(PROFILES_FILE, 'w', encoding='utf-8') as f:
            json.dump(bundle, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: Could not write {PROFILES_FILE}: {e}")

    # 2. Mirror to project directory if separate and writable
    try:
        mirror_path = os.path.join(PROJECT_DIR, 'ap_merin_user_profiles.json')
        if os.path.abspath(mirror_path) != os.path.abspath(PROFILES_FILE) and os.path.isdir(PROJECT_DIR):
            with open(mirror_path, 'w', encoding='utf-8') as f:
                json.dump(bundle, f, indent=2, ensure_ascii=False)
    except Exception:
        pass
        
    return bundle

DEFAULT_TEAM_USERS = [
    {
        'id': 'user_1',
        'name': 'Darvwesvaar',
        'email': 'project@apmerinservices.com.my',
        'password': '',
        'role': 'Project Executive',
        'defaultCc': 'sharrvendran@apmerinservices.com.my, sales02@apmerinservices.com.my, suga@apmerinservices.com.my, navin@apmerinservices.com.my',
        'signatureKey': 'AP_MERIN_SIG_user_1',
        'isAdmin': False
    },
    {
        'id': 'user_2',
        'name': 'Kirthana',
        'email': 'sales02@apmerinservices.com.my',
        'password': '',
        'role': 'Procurement Specialist',
        'defaultCc': 'sharrvendran@apmerinservices.com.my, suga@apmerinservices.com.my, project@apmerinservices.com.my',
        'signatureKey': 'AP_MERIN_SIG_user_2',
        'isAdmin': False
    },
    {
        'id': 'user_3',
        'name': 'Sharrvendran',
        'email': 'sharrvendran@apmerinservices.com.my',
        'password': '',
        'role': 'Operations Lead',
        'defaultCc': 'suga@apmerinservices.com.my, sales02@apmerinservices.com.my, navin@apmerinservices.com.my',
        'signatureKey': 'AP_MERIN_SIG_user_3',
        'isAdmin': False
    },
    {
        'id': 'user_4',
        'name': 'Suga',
        'email': 'suga@apmerinservices.com.my',
        'password': '',
        'role': 'Sales Executive',
        'defaultCc': 'sharrvendran@apmerinservices.com.my, sales02@apmerinservices.com.my, project@apmerinservices.com.my',
        'signatureKey': 'AP_MERIN_SIG_user_4',
        'isAdmin': False
    },
    {
        'id': 'user_5',
        'name': 'Navin',
        'email': 'navin@apmerinservices.com.my',
        'password': '',
        'role': 'Technical Lead',
        'defaultCc': 'sharrvendran@apmerinservices.com.my, suga@apmerinservices.com.my, sales02@apmerinservices.com.my, project@apmerinservices.com.my',
        'signatureKey': 'AP_MERIN_SIG_user_5',
        'isAdmin': False
    }
]

DEFAULT_ADMIN_USER_DICT = {
    'id': 'user_admin',
    'name': 'Chief Administrator',
    'email': 'admin@apmerinservices.com.my',
    'password': '',
    'role': 'Administrator',
    'defaultCc': 'project@apmerinservices.com.my',
    'signatureKey': 'AP_MERIN_SIG_user_admin',
    'isAdmin': True
}

def _get_profile_candidate_paths():
    exe_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else ''
    candidates = [
        PROFILES_FILE,
        os.path.join(exe_dir, 'ap_merin_user_profiles.json') if exe_dir else '',
        os.path.join(exe_dir, '_internal', 'ap_merin_user_profiles.json') if exe_dir else '',
        getattr(sys, '_MEIPASS', '') and os.path.join(getattr(sys, '_MEIPASS', ''), 'ap_merin_user_profiles.json'),
        os.path.join(PROJECT_DIR, 'ap_merin_user_profiles.json'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ap_merin_user_profiles.json'),
        os.path.join(os.getcwd(), 'ap_merin_user_profiles.json'),
        r"C:\Users\Victus\Desktop\AP MERIN APPLICATION\ap_merin_user_profiles.json",
        r"C:\Users\Victus\AppData\Roaming\AP_Merin_Services\ap_merin_user_profiles.json"
    ]
    seen = set()
    result = []
    for c in candidates:
        if c and os.path.isfile(c):
            norm = os.path.abspath(c)
            if norm not in seen:
                seen.add(norm)
                result.append(norm)
    return result

def _is_users_incomplete(users):
    if not users or not isinstance(users, list) or len(users) < 5:
        return True
    for u in users:
        if not isinstance(u, dict):
            return True
        if not u.get('email') or not u.get('password'):
            return True
    return False

def load_user_profiles_bundle():
    """
    Loads user profiles bundle from SQLite (with automatic fallback to ap_merin_user_profiles.json).
    Guarantees all 5 team member profiles with emails, passwords, roles, and default CCs.
    """
    users_raw = get_app_setting('system_users')
    admin_raw = get_app_setting('admin_user')
    active_user_id = get_app_setting('active_user_id')
    
    users = None
    admin = None
    if users_raw:
        try:
            users = json.loads(users_raw)
        except Exception:
            pass
    if admin_raw:
        try:
            admin = json.loads(admin_raw)
        except Exception:
            pass

    # If users are missing, incomplete, or empty, search candidate JSON bundles
    if _is_users_incomplete(users):
        candidates = _get_profile_candidate_paths()
        for cand_path in candidates:
            try:
                with open(cand_path, 'r', encoding='utf-8') as f:
                    file_bundle = json.load(f)
                    file_users = file_bundle.get('users')
                    if file_users and isinstance(file_users, list) and len(file_users) >= 5:
                        # Check if this bundle has emails
                        if any(u.get('email') for u in file_users):
                            users = file_users
                            save_app_setting('system_users', json.dumps(users))
                            if not admin or not admin.get('email'):
                                admin = file_bundle.get('admin') or DEFAULT_ADMIN_USER_DICT
                                save_app_setting('admin_user', json.dumps(admin))
                            if not active_user_id:
                                active_user_id = file_bundle.get('active_user_id') or 'user_1'
                                save_app_setting('active_user_id', str(active_user_id))
                            # Also import signatures into SQLite
                            sigs = file_bundle.get('signatures', {})
                            for sk, sv in sigs.items():
                                if sv:
                                    save_app_setting(f"sig_{sk}", sv)
                            # Ensure saved to primary PROFILES_FILE
                            try:
                                with open(PROFILES_FILE, 'w', encoding='utf-8') as pf:
                                    json.dump(file_bundle, pf, indent=2, ensure_ascii=False)
                            except Exception:
                                pass
                            break
            except Exception as e:
                print(f"Warning: Error reading candidate {cand_path}: {e}")

    # Fallback to hardcoded team defaults if still incomplete
    if _is_users_incomplete(users):
        users = [dict(u) for u in DEFAULT_TEAM_USERS]
        save_app_setting('system_users', json.dumps(users))

    if not admin or not isinstance(admin, dict) or not admin.get('email'):
        admin = dict(DEFAULT_ADMIN_USER_DICT)
        save_app_setting('admin_user', json.dumps(admin))

    if not active_user_id:
        active_user_id = 'user_1'
        save_app_setting('active_user_id', str(active_user_id))

    # Guarantee that Default CCs for team members and admin always reflect current master settings
    team_cc_map = {u['id']: u['defaultCc'] for u in DEFAULT_TEAM_USERS}
    team_cc_by_email = {u['email'].lower(): u['defaultCc'] for u in DEFAULT_TEAM_USERS}
    updated_users_cc = False
    if users and isinstance(users, list):
        for u in users:
            uid = u.get('id')
            uem = (u.get('email') or '').lower()
            target_cc = team_cc_map.get(uid) or team_cc_by_email.get(uem)
            if target_cc and u.get('defaultCc') != target_cc:
                u['defaultCc'] = target_cc
                updated_users_cc = True
    if updated_users_cc:
        save_app_setting('system_users', json.dumps(users))
        try:
            if os.path.exists(PROFILES_FILE):
                with open(PROFILES_FILE, 'r', encoding='utf-8') as pf:
                    pdata = json.load(pf)
                pdata['users'] = users
                with open(PROFILES_FILE, 'w', encoding='utf-8') as pf:
                    json.dump(pdata, pf, indent=2, ensure_ascii=False)
        except Exception:
            pass

    if admin and isinstance(admin, dict):
        if admin.get('defaultCc') != DEFAULT_ADMIN_USER_DICT['defaultCc']:
            admin['defaultCc'] = DEFAULT_ADMIN_USER_DICT['defaultCc']
            save_app_setting('admin_user', json.dumps(admin))

    return {
        'users': users,
        'admin': admin,
        'active_user_id': active_user_id
    }

def _get_all_signature_alias_keys(sig_key_or_user_id=None):
    """
    Returns a mapping of user identifiers to all possible signature alias keys,
    or returns all related alias keys for a specific sig_key or user_id.
    """
    alias_groups = [
        # user_1 / Darvwesvaar
        {'id': 'user_1', 'keys': [
            'AP_MERIN_SIG_user_1', 'AP_MERIN_SIG_user_darvwesvaar', 'AP_MERIN_SIG_darvwesvaar',
            'AP_MERIN_SIG_project', 'AP_MERIN_SIG_user_project'
        ]},
        # user_2 / Kirthana
        {'id': 'user_2', 'keys': [
            'AP_MERIN_SIG_user_2', 'AP_MERIN_SIG_user_kirthana', 'AP_MERIN_SIG_kirthana',
            'AP_MERIN_SIG_sales02', 'AP_MERIN_SIG_user_sales02'
        ]},
        # user_3 / Sharrvendran
        {'id': 'user_3', 'keys': [
            'AP_MERIN_SIG_user_3', 'AP_MERIN_SIG_user_sharrvendran', 'AP_MERIN_SIG_sharrvendran'
        ]},
        # user_4 / Suga
        {'id': 'user_4', 'keys': [
            'AP_MERIN_SIG_user_4', 'AP_MERIN_SIG_user_suga', 'AP_MERIN_SIG_suga'
        ]},
        # user_5 / Navin
        {'id': 'user_5', 'keys': [
            'AP_MERIN_SIG_user_5', 'AP_MERIN_SIG_user_navin', 'AP_MERIN_SIG_navin'
        ]},
        # user_admin / Admin
        {'id': 'user_admin', 'keys': [
            'AP_MERIN_SIG_user_admin', 'AP_MERIN_SIG_admin'
        ]}
    ]
    if not sig_key_or_user_id:
        return alias_groups

    target = str(sig_key_or_user_id).lower().strip()
    for group in alias_groups:
        if group['id'].lower() == target:
            return list(group['keys'])
        for k in group['keys']:
            if k.lower() == target:
                return list(group['keys'])

    return [sig_key_or_user_id]

def save_signature_html(sig_key, html_content, user_id=None):
    """
    Saves signature HTML into SQLite app_settings and JSON backup.
    Automatically mirrors the saved signature across all alias keys for that user.
    """
    if not sig_key:
        return False

    html_str = html_content or ''
    keys_to_update = set()
    if user_id:
        for k in _get_all_signature_alias_keys(user_id):
            keys_to_update.add(k)
    for k in _get_all_signature_alias_keys(sig_key):
        keys_to_update.add(k)
    keys_to_update.add(sig_key)

    # 1. Save all alias keys to SQLite app_settings
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for k in keys_to_update:
        save_app_setting(f"sig_{k}", html_str)
        save_app_setting(f"sig_updated_at_{k}", now_iso)
    
    # 2. Update in JSON backup (PROFILES_FILE)
    bundle = {}
    if os.path.exists(PROFILES_FILE):
        try:
            with open(PROFILES_FILE, 'r', encoding='utf-8') as f:
                bundle = json.load(f)
        except Exception:
            bundle = {}
    if 'signatures' not in bundle or not isinstance(bundle['signatures'], dict):
        bundle['signatures'] = {}
    for k in keys_to_update:
        bundle['signatures'][k] = html_str
    bundle['signatures_updated_at'] = now_iso

    try:
        with open(PROFILES_FILE, 'w', encoding='utf-8') as f:
            json.dump(bundle, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: Could not write signature to {PROFILES_FILE}: {e}")

    # 3. Mirror to project directory
    try:
        mirror_path = os.path.join(PROJECT_DIR, 'ap_merin_user_profiles.json')
        if os.path.abspath(mirror_path) != os.path.abspath(PROFILES_FILE) and os.path.isdir(PROJECT_DIR):
            with open(mirror_path, 'w', encoding='utf-8') as f:
                json.dump(bundle, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    return True

def load_all_signatures():
    """
    Retrieves all signatures from SQLite and JSON backup.
    Authoritative order:
    1. SQLite app_settings (local persistent DB)
    2. Primary PROFILES_FILE in PERSISTENT_DATA_DIR (AppData)
    3. Candidate JSON bundles in project/exe dirs (fallback seeds only)
    Never overwrites an edited signature based on string length!
    """
    signatures = {}
    
    # 1. From SQLite app_settings (Authoritative Primary)
    try:
        init_database()
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'sig_%'")
        for row in cur.fetchall():
            k = row['setting_key']
            if k.startswith('sig_updated_at_'):
                continue
            sig_key = k[4:] if k.startswith('sig_') else k
            v = row['setting_value']
            if v and str(v).strip():
                signatures[sig_key] = v
        conn.close()
    except Exception as e:
        print(f"Error loading signatures from SQLite: {e}")

    # 2. From primary PROFILES_FILE in PERSISTENT_DATA_DIR if missing in SQLite
    if os.path.exists(PROFILES_FILE):
        try:
            with open(PROFILES_FILE, 'r', encoding='utf-8') as f:
                bundle = json.load(f)
                sigs = bundle.get('signatures', {})
                if sigs and isinstance(sigs, dict):
                    for sk, sv in sigs.items():
                        if sv and str(sv).strip() and sk not in signatures:
                            signatures[sk] = sv
        except Exception as e:
            print(f"Error reading primary PROFILES_FILE signatures: {e}")

    # 3. Fallback seeds from candidate JSON bundles ONLY for keys not yet in signatures
    for cand_path in _get_profile_candidate_paths():
        if os.path.abspath(cand_path) == os.path.abspath(PROFILES_FILE):
            continue
        try:
            with open(cand_path, 'r', encoding='utf-8') as f:
                bundle = json.load(f)
                sigs = bundle.get('signatures', {})
                if sigs and isinstance(sigs, dict):
                    for sk, sv in sigs.items():
                        if sv and str(sv).strip() and sk not in signatures:
                            signatures[sk] = sv
        except Exception:
            pass

    # 4. Synchronize alias keys across each user group so all aliases have the exact same signature
    for group in _get_all_signature_alias_keys():
        keys = group['keys']
        # Find best signature in this group: prefer primary key, then any alias with content
        primary_val = None
        for k in keys:
            if signatures.get(k) and signatures[k].strip():
                primary_val = signatures[k]
                break
        if primary_val:
            for k in keys:
                signatures[k] = primary_val

    # 5. Backfill signatures into SQLite app_settings
    for k, v in signatures.items():
        if v:
            save_app_setting(f"sig_{k}", v)
        
    return signatures

# =========================================================================
# AUTHENTICATION SESSION PERSISTENCE ENGINE (REMEMBER ME / AUTO-LOGIN)
# =========================================================================
def save_auth_session(user_data, remember_me=True):
    """
    Persists authenticated login session into SQLite and auth_session.json in PERSISTENT_DATA_DIR.
    """
    session = {
        'authenticated': True,
        'user': user_data,
        'user_id': user_data.get('id') if isinstance(user_data, dict) else str(user_data),
        'email': user_data.get('email') if isinstance(user_data, dict) else '',
        'name': user_data.get('name') if isinstance(user_data, dict) else '',
        'remember_me': bool(remember_me),
        'saved_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'device_id': get_machine_id()
    }
    # Save to SQLite
    save_app_setting('auth_session', json.dumps(session))
    if user_data and isinstance(user_data, dict) and user_data.get('id'):
        save_app_setting('active_user_id', str(user_data['id']))

    # Save to JSON file in PERSISTENT_DATA_DIR
    try:
        with open(SESSION_FILE, 'w', encoding='utf-8') as f:
            json.dump(session, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: Could not save session to {SESSION_FILE}: {e}")

    return session

def load_auth_session():
    """
    Loads persistent authenticated login session from JSON or SQLite.
    Returns session dict if authenticated and remember_me is True, else None.
    """
    session = None
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, 'r', encoding='utf-8') as f:
                session = json.load(f)
        except Exception:
            session = None

    if not session:
        raw = get_app_setting('auth_session')
        if raw:
            try:
                session = json.loads(raw)
            except Exception:
                session = None

    if session and session.get('authenticated') and session.get('remember_me'):
        return session
    return None

def clear_auth_session():
    """
    Clears the saved persistent login session on explicit user logout.
    """
    save_app_setting('auth_session', '')
    if os.path.exists(SESSION_FILE):
        try:
            os.remove(SESSION_FILE)
        except Exception:
            try:
                with open(SESSION_FILE, 'w', encoding='utf-8') as f:
                    json.dump({'authenticated': False}, f)
            except Exception:
                pass
def _get_contacts_candidate_paths():
    exe_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else ''
    candidates = [
        CONTACTS_FILE,
        os.path.join(exe_dir, 'ap_merin_contacts.json') if exe_dir else '',
        os.path.join(exe_dir, '_internal', 'ap_merin_contacts.json') if exe_dir else '',
        getattr(sys, '_MEIPASS', '') and os.path.join(getattr(sys, '_MEIPASS', ''), 'ap_merin_contacts.json'),
        os.path.join(PROJECT_DIR, 'ap_merin_contacts.json'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ap_merin_contacts.json'),
        os.path.join(os.getcwd(), 'ap_merin_contacts.json'),
        r"C:\Users\Victus\Desktop\AP MERIN APPLICATION\ap_merin_contacts.json",
        r"C:\Users\Victus\AppData\Roaming\AP_Merin_Services\ap_merin_contacts.json"
    ]
    seen = set()
    result = []
    for c in candidates:
        if c and os.path.isfile(c):
            norm = os.path.abspath(c)
            if norm not in seen:
                seen.add(norm)
                result.append(norm)
    return result

def seed_default_contacts_internal(cur):
    """Pre-seeds standard company team members, master contacts JSON, and frequent suppliers into email_contacts."""
    initial_contacts = []
    # 0. Load contacts from candidate contacts JSON files (master bundled contacts)
    for cpath in _get_contacts_candidate_paths():
        try:
            with open(cpath, 'r', encoding='utf-8') as f:
                cdata = json.load(f)
                clist = cdata.get('contacts', [])
                if clist and isinstance(clist, list):
                    for c in clist:
                        if isinstance(c, dict) and c.get('email'):
                            initial_contacts.append(c)
                    if len(initial_contacts) >= 30:
                        break
        except Exception:
            pass

    # 1. Team members from user profiles
    if os.path.exists(PROFILES_FILE):
        try:
            with open(PROFILES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                users = data.get('users', [])
                for u in users:
                    if u.get('email'):
                        initial_contacts.append({
                            'name': u.get('name') or u.get('username', ''),
                            'email': u['email'],
                            'company': 'AP Merin Services',
                            'notes': f"Role: {u.get('designation') or 'Team Member'}"
                        })
        except Exception:
            pass

    # 2. Known historical suppliers
    default_suppliers = [
        {"name": "Isadora", "email": "isadora@shunkongmarine.com", "company": "Shunkong Marine Electric", "notes": "Parts Supplier (China)"},
        {"name": "Lucy Qiao", "email": "lucy@shunkongmarine.com", "company": "Shunkong Marine Electric", "notes": "Parts Supplier (China)"},
        {"name": "Sales Engine", "email": "sales79@client-engine.com", "company": "Client Engine", "notes": "Diesel Engine & Genset Parts"},
        {"name": "Sales Team", "email": "sales@challengepower.cn", "company": "Challenge Power", "notes": "Cooling, Heat Exchangers, Gaskets"},
        {"name": "Song", "email": "sales5@jinbomarine.com", "company": "Jinbo Marine", "notes": "Marine Engine Spares"},
        {"name": "Oceantech Sales", "email": "oceantech@ost.gr", "company": "Oceantech Ltd", "notes": "OEM Marine & Industrial Spares (Greece)"},
        {"name": "KIM", "email": "myeong-seong@myeong-seong.co.kr", "company": "Myeong Seong Co", "notes": "Korean Marine Equipment"},
        {"name": "Kenny Lee", "email": "kennyleewh@yahoo.com.my", "company": "Yahoo Supplier", "notes": "Filters & Consumables"},
        {"name": "Annie Wong", "email": "anniewong@donaldfil.com", "company": "Donaldson Filtration", "notes": "Marine Filtration"}
    ]
    for ds in default_suppliers:
        initial_contacts.append(ds)

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for c in initial_contacts:
        em = (c.get('email') or '').lower().strip()
        if not em or '@' not in em:
            continue
        nm = c.get('name') or em.split('@')[0]
        cmp = c.get('company', '')
        nts = c.get('notes', '')
        freq = c.get('frequency', 1)
        lu = c.get('last_used', now)
        ca = c.get('created_at', now)
        cur.execute('''
        INSERT INTO email_contacts (name, email, company, notes, frequency, last_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            name = CASE WHEN excluded.name != '' THEN excluded.name ELSE email_contacts.name END,
            company = CASE WHEN excluded.company != '' THEN excluded.company ELSE email_contacts.company END,
            notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE email_contacts.notes END,
            updated_at = excluded.updated_at
        ''', (nm, em, cmp, nts, freq, lu, ca, now))

def get_email_contacts(query=None, limit=100):
    """
    Returns contacts matching search query or ordered by usage frequency and recency.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    if query and query.strip():
        q = f"%{query.strip().lower()}%"
        cur.execute('''
            SELECT id, name, email, company, notes, frequency, last_used, created_at, updated_at
            FROM email_contacts
            WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?
            ORDER BY 
                CASE WHEN LOWER(name) LIKE ? THEN 1 WHEN LOWER(email) LIKE ? THEN 2 ELSE 3 END,
                frequency DESC, last_used DESC
            LIMIT ?
        ''', (q, q, q, f"{query.strip().lower()}%", f"{query.strip().lower()}%", limit))
    else:
        cur.execute('''
            SELECT id, name, email, company, notes, frequency, last_used, created_at, updated_at
            FROM email_contacts
            ORDER BY frequency DESC, last_used DESC
            LIMIT ?
        ''', (limit,))
    
    rows = cur.fetchall()
    contacts = []
    for r in rows:
        contacts.append({
            "id": r[0],
            "name": r[1] or "",
            "email": r[2] or "",
            "company": r[3] or "",
            "notes": r[4] or "",
            "frequency": r[5] or 1,
            "last_used": r[6] or "",
            "created_at": r[7] or "",
            "updated_at": r[8] or ""
        })
    conn.close()
    return contacts

def upsert_email_contact(name, email_addr, company="", notes=""):
    """
    Inserts or updates contact by email. Increments frequency and sets last_used.
    """
    if not email_addr or "@" not in email_addr:
        return None
    email_clean = email_addr.strip().lower()
    name_clean = (name or "").strip()
    company_clean = (company or "").strip()
    notes_clean = (notes or "").strip()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO email_contacts (name, email, company, notes, frequency, last_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            name = CASE WHEN ? != '' THEN ? ELSE email_contacts.name END,
            company = CASE WHEN ? != '' THEN ? ELSE email_contacts.company END,
            notes = CASE WHEN ? != '' THEN ? ELSE email_contacts.notes END,
            frequency = email_contacts.frequency + 1,
            last_used = ?,
            updated_at = ?
    ''', (name_clean or email_clean.split('@')[0], email_clean, company_clean, notes_clean, now, now, now,
          name_clean, name_clean, company_clean, company_clean, notes_clean, notes_clean, now, now))
    conn.commit()
    
    cur.execute('SELECT id, name, email, company, notes, frequency, last_used FROM email_contacts WHERE email = ?', (email_clean,))
    row = cur.fetchone()
    conn.close()

    sync_contacts_to_json()

    if row:
        return {"id": row[0], "name": row[1], "email": row[2], "company": row[3], "notes": row[4], "frequency": row[5], "last_used": row[6]}
    return None

def bulk_upsert_email_contacts(contacts_list):
    """
    Bulk upserts a list of dicts or email strings. Automatically extracts names if provided as 'Name <email>'.
    """
    if not contacts_list:
        return 0
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    conn = get_db_connection()
    cur = conn.cursor()
    count = 0
    for item in contacts_list:
        if isinstance(item, str):
            item_str = item.strip()
            m = re.match(r'^(.*?)\s*<([^>]+)>$', item_str)
            if m:
                nm = m.group(1).strip().strip('"\'')
                em = m.group(2).strip().lower()
            else:
                em = item_str.lower()
                nm = em.split('@')[0].capitalize() if '@' in em else em
            cmp = ""
            notes = ""
        elif isinstance(item, dict):
            em = (item.get('email') or '').strip().lower()
            nm = (item.get('name') or '').strip()
            cmp = (item.get('company') or '').strip()
            notes = (item.get('notes') or '').strip()
        else:
            continue

        if not em or '@' not in em:
            continue

        cur.execute('''
            INSERT INTO email_contacts (name, email, company, notes, frequency, last_used, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                name = CASE WHEN ? != '' THEN ? ELSE email_contacts.name END,
                company = CASE WHEN ? != '' THEN ? ELSE email_contacts.company END,
                notes = CASE WHEN ? != '' THEN ? ELSE email_contacts.notes END,
                frequency = email_contacts.frequency + 1,
                last_used = ?,
                updated_at = ?
        ''', (nm or em.split('@')[0], em, cmp, notes, now, now, now,
              nm, nm, cmp, cmp, notes, notes, now, now))
        count += 1

    conn.commit()
    conn.close()
    sync_contacts_to_json()
    return count

def delete_email_contact(contact_id):
    """Deletes contact by ID."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM email_contacts WHERE id = ?", (contact_id,))
    conn.commit()
    conn.close()
    sync_contacts_to_json()
    return True

def sync_contacts_to_json():
    """Dumps all contacts to ap_merin_contacts.json for portable cross-device sync."""
    try:
        contacts = get_email_contacts(limit=5000)
        with open(CONTACTS_FILE, 'w', encoding='utf-8') as f:
            json.dump({"contacts": contacts, "synced_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: Could not sync contacts to JSON: {e}")

def import_contacts_csv_or_excel(file_bytes, filename):
    """
    Parses an uploaded CSV or Excel file and imports contacts.
    Returns (success_count, total_count, error_msg).
    """
    fn = filename.lower()
    records = []
    try:
        if fn.endswith('.csv'):
            text = file_bytes.decode('utf-8', errors='ignore')
            reader = csv.reader(io.StringIO(text))
            rows = list(reader)
        elif fn.endswith('.xlsx') or fn.endswith('.xls'):
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            sheet = wb.active
            rows = [[str(c) if c is not None else "" for c in r] for r in sheet.iter_rows(values_only=True)]
        else:
            return 0, 0, "Unsupported file format. Please upload a .csv or .xlsx file."

        if not rows:
            return 0, 0, "Uploaded file is empty."

        header = [str(c).lower().strip() for c in rows[0]]
        email_col = -1
        name_col = -1
        company_col = -1
        notes_col = -1

        for i, col in enumerate(header):
            if 'email' in col or 'e-mail' in col:
                email_col = i
            elif 'name' in col or 'contact' in col:
                name_col = i
            elif 'company' in col or 'supplier' in col or 'client' in col or 'org' in col:
                company_col = i
            elif 'note' in col or 'remark' in col or 'role' in col:
                notes_col = i

        start_row = 1 if email_col != -1 else 0
        if email_col == -1:
            # Try finding any column that has an '@' symbol
            for r_idx in range(min(5, len(rows))):
                for c_idx, val in enumerate(rows[r_idx]):
                    if '@' in str(val):
                        email_col = c_idx
                        break
                if email_col != -1:
                    break

        if email_col == -1:
            return 0, 0, "Could not locate an Email column in the file."

        for row in rows[start_row:]:
            if not row or len(row) <= email_col:
                continue
            em = str(row[email_col]).strip()
            if not em or '@' not in em:
                continue
            nm = str(row[name_col]).strip() if (name_col != -1 and len(row) > name_col) else ""
            cmp = str(row[company_col]).strip() if (company_col != -1 and len(row) > company_col) else ""
            nts = str(row[notes_col]).strip() if (notes_col != -1 and len(row) > notes_col) else ""
            records.append({
                'name': nm,
                'email': em,
                'company': cmp,
                'notes': nts
            })

        count = bulk_upsert_email_contacts(records)
        return count, len(records), None
    except Exception as ex:
        return 0, 0, str(ex)

# Auto-initialize database when module loads
try:
    if os.environ.get('APMERIN_SHARED_MODE')!='1':init_database()
except Exception as e:
    print(f"Notice: Database auto-init error: {e}")
