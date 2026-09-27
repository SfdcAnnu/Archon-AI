"""
Build the Archon package source from force-app.

force-app stays the working project (demo org, WhatsApp, Lead samples).
This copies only the package components into ArchonPackage/force-app,
a separate SFDX project the package versions are created from.

Run from the repo root after changing force-app:
    python scripts/build-package-source.py

Only git-tracked files are copied, so node_modules and local build
leftovers never reach the package. Commit force-app first.
"""
import os
import re
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = 'force-app/main/default/'
OUT = os.path.join(ROOT, 'ArchonPackage', 'force-app')

# Components that stay out of the package, relative to force-app/main/default.
# A path ending in / excludes the whole folder.
EXCLUDE = [
    # Callers of package Apex + 360 SMS (tdc_tsw) integration
    'classes/SendWhatsAppMessage.cls',
    'classes/WhatsAppAgentBridge.cls',
    'classes/WhatsAppAgentBridgeTest.cls',
    'classes/WhatsAppRevivalInitiator.cls',
    'classes/WhatsAppRevivalInitiatorTest.cls',
    'classes/LeadAgentTriggerHandler.cls',
    'classes/LeadAgentTriggerHandlerTest.cls',
    'triggers/',
    'flows/',
    # Standard-object customisation
    'objects/Account/',
    'objects/Lead/',
    'objects/Opportunity/',
    'objects/Product2/',
    'layouts/Account-Account Layout.layout-meta.xml',
    'layouts/Lead-Lead Layout.layout-meta.xml',
    'layouts/Opportunity-Opportunity Layout.layout-meta.xml',
    'standardValueSets/',
    'permissionsets/LeadQualificationFields.permissionset-meta.xml',
    # Unused secret; its value must not ship to subscriber orgs
    'objects/ArchonConfig__mdt/fields/JwtSecret__c.field-meta.xml',
]

# Grants in the core permission sets that point at excluded components.
PERMSET_CLASSES = ['SendWhatsAppMessage', 'LeadAgentTriggerHandler']
PERMSET_FIELDS = ['Opportunity.CompetitorIntel__c', 'Product2.MaxDiscountPercent__c']


def excluded(rel):
    for e in EXCLUDE:
        if e.endswith('/'):
            if rel.startswith(e):
                return True
        elif rel == e or rel == e + '-meta.xml':
            return True
    return False


def strip_permset(text):
    for c in PERMSET_CLASSES:
        text = re.sub(r'\n\s*<classAccesses>\s*<apexClass>' + c +
                      r'</apexClass>\s*<enabled>\w+</enabled>\s*</classAccesses>', '', text)
    for f in PERMSET_FIELDS:
        text = re.sub(r'\n[ \t]*<fieldPermissions>\s*<field>' + re.escape(f) +
                      r'</field>.*?</fieldPermissions>', '', text, flags=re.S)
    return text


def strip_config_record(text):
    return re.sub(r'\s*<values>\s*<field>JwtSecret__c</field>.*?</values>', '', text, flags=re.S)


def main():
    tracked = subprocess.run(['git', 'ls-files', '-z', SRC], cwd=ROOT, check=True,
                             capture_output=True).stdout.decode('utf-8').split('\0')
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)

    copied = skipped = 0
    for path in filter(None, tracked):
        rel = path[len(SRC):]
        if excluded(rel):
            skipped += 1
            continue
        src = os.path.join(ROOT, path)
        if not os.path.exists(src):  # deleted but not yet committed
            continue
        dst = os.path.join(OUT, 'main', 'default', rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if rel.startswith('permissionsets/') or rel == 'customMetadata/ArchonConfig.Default.md-meta.xml':
            with open(src, encoding='utf-8') as fh:
                text = fh.read()
            text = strip_permset(text) if rel.startswith('permissionsets/') else strip_config_record(text)
            with open(dst, 'w', encoding='utf-8', newline='') as fh:
                fh.write(text)
        else:
            shutil.copyfile(src, dst)
        copied += 1

    # Nothing left in the package may still point at an excluded component.
    leftovers = []
    needles = PERMSET_CLASSES + PERMSET_FIELDS + ['tdc_tsw', 'JwtSecret__c',
               'WhatsAppAgentBridge', 'WhatsAppRevivalInitiator', 'LeadAgentTrigger']
    for d, _, files in os.walk(OUT):
        for f in files:
            if not f.endswith(('.xml', '.cls', '.trigger', '.js')) or 'uiBundles' in d:
                continue
            with open(os.path.join(d, f), encoding='utf-8', errors='ignore') as fh:
                body = fh.read()
            code = re.sub(r'//.*|/\*.*?\*/', '', body, flags=re.S) if f.endswith('.cls') else body
            hits = [n for n in needles if n in code]
            if hits:
                leftovers.append('%s: %s' % (os.path.relpath(os.path.join(d, f), OUT), ', '.join(hits)))

    print('Copied %d files, left out %d.' % (copied, skipped))
    if leftovers:
        print('Package still references excluded components:')
        for l in leftovers:
            print('  ' + l)
        raise SystemExit(1)
    print('No references to excluded components.')


if __name__ == '__main__':
    main()
