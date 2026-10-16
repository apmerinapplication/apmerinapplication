import os
import io
import re
import uuid
import base64
import smtplib
import tempfile
import mimetypes
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.mime.base import MIMEBase
from email import encoders
from email.utils import formatdate, make_msgid
from bs4 import BeautifulSoup


def normalize_email_html_spacing(soup_or_html):
    """
    Normalizes paragraph and block spacing in HTML emails.
    Inlines zero-margin resets, consistent 13.5px font sizing, and Trebuchet MS typography
    on <p>, <div>, and <li> tags so email clients (Outlook Desktop Word engine,
    Gmail, Apple Mail, Webmail) do not inflate vertical margins or display oversized 16px fonts.
    Accepts either a BeautifulSoup object or an HTML string.
    """
    is_str = isinstance(soup_or_html, str)
    if is_str:
        soup = BeautifulSoup(soup_or_html, "html.parser")
    else:
        soup = soup_or_html

    trebuchet_stack = "'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif"

    # Replace any unquoted or hyphenated font-family references throughout the document
    for tag in soup.find_all(True):
        style = tag.get('style', '')
        if 'trebuchet-ms' in style.lower():
            tag['style'] = re.sub(r"font-family:\s*['\"]?trebuchet-ms['\"]?", f"font-family: {trebuchet_stack}", style, flags=re.IGNORECASE)

    for p in soup.find_all(['p', 'div']):
        # If this is the email-signature container, give it a clean top margin
        classes = p.get('class', [])
        if isinstance(classes, str):
            classes = [classes]
        if 'email-signature' in classes or any('signature' in str(c).lower() for c in classes):
            curr_style = p.get('style', '')
            if 'margin-top' not in curr_style:
                p['style'] = f"{curr_style}; margin-top: 20px; padding-top: 10px;".strip('; ')
            continue

        curr_style = p.get('style', '')
        style_parts = [s.strip() for s in curr_style.split(';') if s.strip()]
        new_parts = []
        has_margin = False
        has_line_height = False
        has_font_size = False
        has_font_family = False
        for part in style_parts:
            low = part.lower()
            if low.startswith('margin') or 'margin-top' in low or 'margin-bottom' in low:
                has_margin = True
            if 'line-height' in low:
                has_line_height = True
            if low.startswith('font-size'):
                has_font_size = True
            if low.startswith('font-family'):
                has_font_family = True
                if 'trebuchet-ms' in low:
                    part = f"font-family: {trebuchet_stack}"
            new_parts.append(part)
        
        if not has_margin:
            new_parts.append('margin: 0; margin-bottom: 0px; margin-top: 0px; padding: 0')
        if not has_line_height:
            new_parts.append('line-height: 1.5')
        if not has_font_size:
            new_parts.append('font-size: 13.5px')
        if not has_font_family:
            new_parts.append(f"font-family: {trebuchet_stack}")
            
        p['style'] = '; '.join(new_parts)

    for li in soup.find_all(['li']):
        curr_style = li.get('style', '')
        low_style = curr_style.lower()
        parts = [s.strip() for s in curr_style.split(';') if s.strip()]
        if 'margin' not in low_style:
            parts.append('margin: 2px 0; padding: 0')
        if 'line-height' not in low_style:
            parts.append('line-height: 1.5')
        if 'font-size' not in low_style:
            parts.append('font-size: 13.5px')
        if 'font-family' not in low_style:
            parts.append(f"font-family: {trebuchet_stack}")
        li['style'] = '; '.join(parts)

    return str(soup) if is_str else soup


def process_html_inline_images(html_content):
    """
    Extracts base64 data images from HTML and replaces them with CID (Content-ID) references.
    Also normalizes paragraph spacing to guarantee cross-client rendering fidelity.
    Returns:
        processed_html (str): HTML with <img src="cid:...">
        inline_images (list): List of dicts with keys: cid, subtype, data
    """
    if not html_content:
        return "", []

    soup = BeautifulSoup(html_content, "html.parser")
    inline_images = []
    img_tags = soup.find_all("img")

    for idx, img in enumerate(img_tags):
        src = img.get("src", "")
        # Check if it is a base64 data URL
        match = re.match(r"^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$", src, re.DOTALL)
        if match:
            raw_subtype = match.group(1).lower()
            subtype = "jpeg" if raw_subtype in ("jpg", "jpeg") else raw_subtype
            base64_data = match.group(2)

            try:
                img_bytes = base64.b64decode(base64_data)
                cid = f"img_{idx}_{uuid.uuid4().hex[:8]}"
                
                # Replace src with cid:
                img["src"] = f"cid:{cid}"

                # Detect and preserve exact image dimensions for Desktop Outlook & Webmail
                explicit_w = img.get("width")
                explicit_h = img.get("height")
                current_style = img.get("style", "")

                # Check if width or height was specified in style attribute
                if not explicit_w:
                    style_w_match = re.search(r'(?:^|;\s*)width\s*:\s*(\d+)px', current_style, re.IGNORECASE)
                    if style_w_match:
                        explicit_w = style_w_match.group(1)

                if not explicit_h:
                    style_h_match = re.search(r'(?:^|;\s*)height\s*:\s*(\d+)px', current_style, re.IGNORECASE)
                    if style_h_match:
                        explicit_h = style_h_match.group(1)

                # If no explicit dimensions are found, read exact natural size via Pillow
                if not explicit_w or not explicit_h:
                    try:
                        from PIL import Image as PILImage
                        with PILImage.open(io.BytesIO(img_bytes)) as p_img:
                            nat_w, nat_h = p_img.size
                            if not explicit_w:
                                explicit_w = str(nat_w)
                            if not explicit_h:
                                explicit_h = str(nat_h)
                    except Exception:
                        pass

                # Set explicit HTML attributes (essential for Outlook Word engine fidelity)
                if explicit_w:
                    img["width"] = str(explicit_w)
                if explicit_h:
                    img["height"] = str(explicit_h)

                # Format clean inline style with explicit width and responsive max-width
                style_tokens = [
                    s.strip() for s in current_style.split(';')
                    if s.strip() and not s.strip().lower().startswith(('max-width', 'width', 'height'))
                ]
                if explicit_w:
                    style_tokens.append(f"width: {explicit_w}px")
                style_tokens.append("max-width: 100%")
                style_tokens.append("height: auto")
                img["style"] = "; ".join(style_tokens) + ";"

                inline_images.append({
                    "cid": cid,
                    "subtype": subtype,
                    "data": img_bytes
                })
            except Exception as e:
                print(f"[Warning] Failed to decode base64 image {idx}: {e}")

    # Normalize paragraph spacing for perfect email client display
    normalize_email_html_spacing(soup)

    res_html = str(soup)
    if "<html" not in res_html.lower() and "<body" not in res_html.lower():
        res_html = (
            '<!DOCTYPE html>\n'
            '<html>\n'
            '<head>\n'
            '  <meta charset="utf-8">\n'
            '  <style type="text/css">\n'
            '    body, p, div, li { margin: 0; padding: 0; }\n'
            '    p { margin-top: 0 !important; margin-bottom: 0px !important; line-height: 1.5 !important; font-size: 13.5px !important; }\n'
            "    body { font-family: 'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif; font-size: 13.5px; color: #1e293b; line-height: 1.5; }\n"
            '  </style>\n'
            '</head>\n'
            '<body style="margin: 0; padding: 0; font-family: \'Trebuchet MS\', \'Lucida Sans Unicode\', \'Lucida Grande\', \'Lucida Sans\', Arial, sans-serif; font-size: 13.5px; color: #1e293b; line-height: 1.5;">\n'
            f'{res_html}\n'
            '</body>\n'
            '</html>'
        )

    return res_html, inline_images


def build_mime_message(sender_email, sender_name, recipient_email, subject, processed_html, inline_images, file_attachments=None, cc_emails=None):
    """
    Builds an RFC-compliant MIME message with inline CID images, optional CC, and optional file attachments.
    """
    if file_attachments and len(file_attachments) > 0:
        msg_root = MIMEMultipart("mixed")
        msg_related = MIMEMultipart("related")
        msg_root.attach(msg_related)
    else:
        msg_root = MIMEMultipart("related")
        msg_related = msg_root

    # Headers
    if sender_name:
        msg_root["From"] = f"{sender_name} <{sender_email}>"
    else:
        msg_root["From"] = sender_email
        
    if isinstance(recipient_email, (list, tuple)):
        msg_root["To"] = ", ".join([e.strip() for e in recipient_email if e and e.strip()])
    else:
        msg_root["To"] = str(recipient_email).strip()
    
    # CC header
    if cc_emails:
        clean_cc = [c.strip() for c in cc_emails if c and c.strip()]
        if clean_cc:
            msg_root["Cc"] = ", ".join(clean_cc)

    msg_root["Subject"] = subject
    msg_root["Date"] = formatdate(localtime=True)
    msg_root["Message-ID"] = make_msgid()

    # Attach HTML text
    html_part = MIMEText(processed_html, "html", "utf-8")
    msg_related.attach(html_part)

    # Attach inline images (without filename parameter so webmail/email clients don't treat them as attachments)
    for img_info in inline_images:
        try:
            img_part = MIMEImage(img_info["data"], _subtype=img_info["subtype"])
            img_part.add_header("Content-ID", f"<{img_info['cid']}>")
            img_part.add_header("Content-Disposition", "inline")
            msg_related.attach(img_part)
        except Exception as e:
            print(f"[Error] Failed to attach inline image {img_info['cid']}: {e}")

    # Attach external files with preserved original filename
    if file_attachments:
        for item in file_attachments:
            if isinstance(item, (tuple, list)) and len(item) >= 2:
                file_path = item[0]
                target_filename = item[1]
            elif isinstance(item, dict):
                file_path = item.get('path')
                target_filename = item.get('name') or (os.path.basename(file_path) if file_path else "attachment")
            else:
                file_path = str(item)
                target_filename = os.path.basename(file_path)

            if file_path and os.path.isfile(file_path):
                clean_filename = os.path.basename(target_filename) or "attachment"
                content_type, encoding = mimetypes.guess_type(clean_filename)
                if content_type is None or encoding is not None:
                    content_type = "application/octet-stream"
                main_type, sub_type = content_type.split("/", 1)
                
                with open(file_path, "rb") as f:
                    file_data = f.read()

                part = MIMEBase(main_type, sub_type)
                part.set_payload(file_data)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=clean_filename)
                msg_root.attach(part)

    return msg_root


def _create_smtp_session(smtp_host, port, use_ssl, use_tls, timeout=60):
    import ssl
    if use_ssl or port == 465:
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return smtplib.SMTP_SSL(smtp_host, port, context=context, timeout=timeout)
    else:
        server = smtplib.SMTP(smtp_host, port, timeout=timeout)
        if use_tls:
            server.starttls()
        return server


def verify_smtp_connection(smtp_host, smtp_port, username, password, use_ssl=False, use_tls=True):
    """
    Tests connection and authentication with an SMTP server.
    Returns (bool, str message)
    """
    try:
        port = int(smtp_port)
        server = _create_smtp_session(smtp_host, port, use_ssl, use_tls, timeout=30)
        server.login(username, password)
        server.quit()
        return True, "Connected and authenticated successfully!"
    except smtplib.SMTPAuthenticationError as e:
        return False, f"SMTP Authentication Failed (535): Incorrect email password or username for '{username}'. Please verify your actual email password in Email Settings. Details: {e}"
    except (smtplib.SMTPConnectError, ConnectionRefusedError, TimeoutError) as e:
        return False, f"Connection Failed: Could not connect to mail server '{smtp_host}' on port {smtp_port}. Please check server host/port and network connectivity. Details: {e}"
    except Exception as e:
        return False, f"Connection/Authentication failed: {str(e)}"


def send_email_smtp(*args, **kwargs):
    """
    Sends an individual email via SMTP with optional CC, automatic retry,
    flexible arguments (dict or kwargs), and crystal-clear error reporting.
    """
    # Support both send_email_smtp(smtp_config, recipient_email, ...) and send_email_smtp(host=..., ...)
    smtp_config = {}
    recipient_email = None
    subject = ""
    processed_html = ""
    inline_images = []
    file_attachments = None
    cc_emails = None

    if len(args) > 0 and isinstance(args[0], dict):
        smtp_config = dict(args[0])
        if len(args) > 1: recipient_email = args[1]
        if len(args) > 2: subject = args[2]
        if len(args) > 3: processed_html = args[3]
        if len(args) > 4: inline_images = args[4]
        if len(args) > 5: file_attachments = args[5]
        if len(args) > 6: cc_emails = args[6]
    elif "smtp_config" in kwargs and isinstance(kwargs["smtp_config"], dict):
        smtp_config = dict(kwargs["smtp_config"])

    # Merge named kwargs into config or variables
    if "host" in kwargs: smtp_config["smtp_host"] = kwargs["host"]
    if "smtp_host" in kwargs: smtp_config["smtp_host"] = kwargs["smtp_host"]
    if "port" in kwargs: smtp_config["smtp_port"] = kwargs["port"]
    if "smtp_port" in kwargs: smtp_config["smtp_port"] = kwargs["smtp_port"]
    if "username" in kwargs: smtp_config["username"] = kwargs["username"]
    if "password" in kwargs: smtp_config["password"] = kwargs["password"]
    if "sender_email" in kwargs: smtp_config["sender_email"] = kwargs["sender_email"]
    if "sender_name" in kwargs: smtp_config["sender_name"] = kwargs["sender_name"]
    if "use_ssl" in kwargs: smtp_config["use_ssl"] = kwargs["use_ssl"]
    if "use_tls" in kwargs: smtp_config["use_tls"] = kwargs["use_tls"]
    if "imap_host" in kwargs: smtp_config["imap_host"] = kwargs["imap_host"]

    if "recipient_email" in kwargs: recipient_email = kwargs["recipient_email"]
    if "subject" in kwargs: subject = kwargs["subject"]
    if "html_body" in kwargs and not processed_html: processed_html = kwargs["html_body"]
    if "processed_html" in kwargs: processed_html = kwargs["processed_html"]
    if "inline_images" in kwargs: inline_images = kwargs["inline_images"] or []
    if "file_attachments" in kwargs: file_attachments = kwargs["file_attachments"]
    if "cc_emails" in kwargs: cc_emails = kwargs["cc_emails"]

    # If html has inline base64 images and inline_images is empty, parse them automatically
    if processed_html and not inline_images:
        processed_html, inline_images = process_html_inline_images(processed_html)

    smtp_host = smtp_config.get("smtp_host", "smtppro47.mschosting.network")
    smtp_port = int(smtp_config.get("smtp_port", 465))
    username = smtp_config.get("username", "")
    password = smtp_config.get("password", "")
    sender_email = smtp_config.get("sender_email") or username
    sender_name = smtp_config.get("sender_name", "")
    use_ssl = bool(smtp_config.get("use_ssl", False) or smtp_port == 465)
    use_tls = bool(smtp_config.get("use_tls", False) and not use_ssl and smtp_port != 465)

    if not username or not password:
        return False, "Missing SMTP credentials: Username or password is empty. Please configure your email password in Email Settings."

    # Normalize recipient_email to list of clean email strings
    if isinstance(recipient_email, (list, tuple)):
        to_emails = [e.strip() for e in recipient_email if e and e.strip()]
    elif isinstance(recipient_email, str):
        to_emails = [e.strip() for e in re.split(r"[,;]+", recipient_email) if e.strip()]
    else:
        to_emails = [str(recipient_email).strip()]
    to_emails = list(dict.fromkeys(to_emails))

    if not to_emails:
        return False, "No valid recipient email address specified."

    # Clean, deduplicate and exclude any recipient in to_emails from CC if present
    to_lower_set = {t.lower() for t in to_emails}
    raw_clean_cc = [c.strip() for c in (cc_emails or []) if c and c.strip()]
    clean_cc = list(dict.fromkeys([c for c in raw_clean_cc if c.lower() not in to_lower_set]))

    msg = build_mime_message(
        sender_email=sender_email,
        sender_name=sender_name,
        recipient_email=to_emails,
        subject=subject,
        processed_html=processed_html,
        inline_images=inline_images,
        file_attachments=file_attachments,
        cc_emails=clean_cc
    )

    all_recipients = list(dict.fromkeys(to_emails + clean_cc))

    # Attempt send
    last_error = ""
    for attempt in range(2):
        try:
            server = _create_smtp_session(smtp_host, smtp_port, use_ssl, use_tls, timeout=60)
            server.login(username, password)
            server.send_message(msg, from_addr=sender_email, to_addrs=all_recipients)
            server.quit()

            # Save a copy directly into the user's Sent Items folder via IMAP
            try:
                save_to_sent_folder(smtp_config, msg.as_bytes())
            except Exception as e:
                print(f"[Warning] Failed to append sent email to Sent Items: {e}")

            return True, "Sent successfully"
        except smtplib.SMTPAuthenticationError as e:
            # Immediate fail on bad credentials - do NOT retry to avoid server lockouts
            return False, f"SMTP Authentication Failed (535): Incorrect email password or username for '{username}'. Please verify your actual email password in Email Settings. Server message: {e}"
        except smtplib.SMTPRecipientsRefused as e:
            return False, f"Recipient Rejected: The mail server refused recipient address(es): {list(e.recipients.keys())}."
        except smtplib.SMTPSenderRefused as e:
            return False, f"Sender Rejected: The mail server refused sender '{sender_email}'. ({e})"
        except smtplib.SMTPDataError as e:
            return False, f"SMTP Data Error ({e.smtp_code}): {e.smtp_error.decode() if isinstance(e.smtp_error, bytes) else e.smtp_error}"
        except (smtplib.SMTPConnectError, ConnectionRefusedError, TimeoutError) as e:
            last_error = f"Connection Failed: Could not connect to mail server '{smtp_host}' on port {smtp_port}. ({e})"
            if attempt == 0:
                import time
                time.sleep(1.5)
                continue
        except Exception as e:
            last_error = f"SMTP Error: {str(e)}"
            if attempt == 0:
                import time
                time.sleep(1.5)
                continue

    return False, last_error


def save_to_sent_folder(smtp_config, msg_bytes):
    """
    Saves a copy of the sent MIME message to the user's IMAP 'Sent' / 'Sent Items' folder
    so it appears in Outlook, Webmail, and mobile mail clients.
    """
    try:
        import imaplib
        import ssl
        import time

        imap_host = smtp_config.get("imap_host") or smtp_config.get("smtp_host", "")
        username = smtp_config.get("username", "")
        password = smtp_config.get("password", "")

        if not imap_host or not username or not password:
            return False, "Missing credentials"

        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        # Connect to IMAP over SSL (port 993)
        mail = imaplib.IMAP4_SSL(imap_host, 993, ssl_context=context, timeout=20)
        mail.login(username, password)

        # Detect the Sent folder name dynamically
        sent_folder = None
        status, folders = mail.list()
        if status == "OK":
            for f in folders:
                f_str = f.decode("utf-8", errors="ignore")
                # Look for standard special-use \Sent flag
                if "\\Sent" in f_str:
                    match = re.search(r'"([^"]+)"$', f_str)
                    if match:
                        sent_folder = match.group(1)
                        break

        # Fallback common folder names if \Sent flag was not found
        if not sent_folder:
            for candidate in ["Sent Items", "Sent", "INBOX.Sent", "Sent Messages"]:
                status, _ = mail.select(f'"{candidate}"', readonly=True)
                if status == "OK":
                    sent_folder = candidate
                    break

        if not sent_folder:
            sent_folder = "Sent Items"

        now = imaplib.Time2Internaldate(time.time())
        status, resp = mail.append(f'"{sent_folder}"', "(\\Seen)", now, msg_bytes)
        mail.logout()
        return True, f"Saved to {sent_folder}"
    except Exception as e:
        print(f"[Warning] save_to_sent_folder encountered an error: {e}")
        return False, str(e)


def send_email_outlook_com(recipient_email, subject, processed_html, inline_images, file_attachments=None, cc_emails=None, as_draft=False):
    """
    Sends or drafts an email using Classic Outlook COM dispatch.
    """
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0) # 0 = olMailItem
        # Normalize recipient_email to list of clean email strings
        if isinstance(recipient_email, (list, tuple)):
            to_emails = [e.strip() for e in recipient_email if e and e.strip()]
        elif isinstance(recipient_email, str):
            to_emails = [e.strip() for e in re.split(r"[,;]+", recipient_email) if e.strip()]
        else:
            to_emails = [str(recipient_email).strip()]
        to_emails = list(dict.fromkeys(to_emails))

        mail.To = "; ".join(to_emails)
        mail.Subject = subject

        if cc_emails:
            to_lower_set = {t.lower() for t in to_emails}
            raw_clean_cc = [c.strip() for c in cc_emails if c and c.strip()]
            clean_cc = list(dict.fromkeys([c for c in raw_clean_cc if c.lower() not in to_lower_set]))
            if clean_cc:
                mail.CC = "; ".join(clean_cc)

        # Attach inline images
        temp_files = []
        try:
            for img in inline_images:
                ext = img["subtype"]
                temp_file = os.path.join(tempfile.gettempdir(), f"{img['cid']}.{ext}")
                with open(temp_file, "wb") as f:
                    f.write(img["data"])
                temp_files.append(temp_file)

                att = mail.Attachments.Add(temp_file)
                # PR_ATTACH_CONTENT_ID = 0x3712001F
                att.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001F", img["cid"])

            if file_attachments:
                for file_path in file_attachments:
                    if os.path.isfile(file_path):
                        mail.Attachments.Add(os.path.abspath(file_path))

            mail.HTMLBody = processed_html

            if as_draft:
                mail.Save()
                return True, "Saved to Outlook Drafts"
            else:
                mail.Send()
                return True, "Sent via Outlook"
        finally:
            for tf in temp_files:
                try:
                    if os.path.exists(tf):
                        os.remove(tf)
                except Exception:
                    pass

    except Exception as e:
        return False, f"Outlook error: {str(e)}"
