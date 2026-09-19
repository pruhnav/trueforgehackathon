"""Download official Synthea sample data and build one historical demo snapshot."""
import csv, datetime, hashlib, io, json, pathlib, urllib.request, zipfile
URL = 'https://raw.githubusercontent.com/synthetichealth/synthea-sample-data/main/downloads/latest/synthea_sample_data_csv_latest.zip'
ROOT = pathlib.Path(__file__).resolve().parents[1]
blob = urllib.request.urlopen(URL, timeout=60).read()
archive = zipfile.ZipFile(io.BytesIO(blob))
sha = hashlib.sha256(blob).hexdigest()
def rows(file):
    name = next(n for n in archive.namelist() if n.endswith('/'+file) or n == file)
    raw = archive.read(name)
    return [{**r, '_provenance': {'file':file, 'row':i, 'fileSha256':hashlib.sha256(raw).hexdigest()}} for i,r in enumerate(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))),2)]
patients = rows('patients.csv')
encounters = rows('encounters.csv')
encounter = max((e for e in encounters if e['ENCOUNTERCLASS']=='inpatient' and e['STOP']), key=lambda e:e['STOP'])
p = next(p for p in patients if p['Id']==encounter['PATIENT'])
date = encounter['STOP']
def active(r):
    # Date-only boundaries are interpreted conservatively as calendar days.
    return r['PATIENT']==p['Id'] and r['START'][:10]<=date[:10] and (not r['STOP'] or r['STOP'][:10]>date[:10])
sections=[]
def section(heading,text,row):
    sections.append({'id':f's{len(sections)+1}','heading':heading,'text':text,'page':None,'provenance':{**row['_provenance'],'sourcePatientId':p['Id'],'sourceRecordId':row.get('Id'), 'fields':{k:v for k,v in row.items() if k!='_provenance'}}})
section('Historical hospital encounter',f"Synthetic inpatient encounter: {encounter['START']} to {date}. {encounter['DESCRIPTION']}. This is a historical dataset snapshot, not discharge instructions.",encounter)
for file,label in [('medications.csv','Medication history'),('conditions.csv','Condition history'),('careplans.csv','Care-plan history')]:
    for r in filter(active,rows(file)):
        section(label, f"Source-recorded: {r['DESCRIPTION']}. Start: {r['START']}. Stop: {r['STOP'] or 'not recorded'}. Historical context only; discharge dose, timing, and follow-up directions are unverified.",r)
name=' '.join(''.join(c for c in p[k] if not c.isdigit()) for k in ('FIRST','LAST'))
pid='synthea-'+p['Id']
doc={'id':'doc-'+pid,'patientId':pid,'title':'Synthea historical record','kind':'synthea','importedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'provenance':{'source':'Synthea public sample dataset','url':URL,'archiveSha256':sha,'snapshotAt':date,'notice':'Synthetic historical data. No discharge regimen or deadlines inferred.'},'sections':sections}
patient={'id':pid,'name':name,'initials':''.join(n[0] for n in name.split()[:2]),'age':int(date[:4])-int(p['BIRTHDATE'][:4])-(date[5:10]<p['BIRTHDATE'][5:10]),'condition':'Synthea historical sample','dischargedAt':date[:10],'clinician':'Not provided in discharge record','hospital':'Synthea synthetic dataset','color':'lavender','provenance':p['_provenance']}
task={'id':pid+'-review','patientId':pid,'title':'Verify discharge instructions with the care team','detail':'This historical sample has no verified discharge regimen. Review the original instructions before creating dated tasks.','category':'clarification','due':None,'status':'needs_clarification','completedAt':None,'source':{'documentId':doc['id'],'sectionId':'s1','quote':sections[0]['text']}}
out=ROOT/'data'/'synthea-sample.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'patient':patient,'document':doc,'tasks':[task]},indent=2)+'\n',encoding='utf-8')
print(f'Wrote {out.name}: {len(sections)} passages; archive SHA256 {sha}')
