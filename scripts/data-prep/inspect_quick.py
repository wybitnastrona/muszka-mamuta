import pandas as pd

a = pd.read_feather('data/raw/body-annotations-male-cns-v1.0-minconf-0.5.feather')
print("rows:", len(a))

print("\n=== receptorType (top 40) ===")
print(a.receptorType.dropna().value_counts().head(40).to_string())

print("\n=== superclass ===")
print(a.superclass.dropna().value_counts().to_string())

print("\n=== class: gustatory / sensory / motor ===")
c = a['class'].dropna()
print(c[c.str.contains('gust|sensor|motor|ascend|descend', case=False)].value_counts().to_string())

pats = {
    'sweet':    r'Gr64|Gr5a|sweet|sugar',
    'bitter':   r'Gr66|bitter',
    'aa':       r'Ir76b|Ir94|amino',
    'creatine': r'creatine|kreatyn|Ir76b|amino',
    'MN9':      r'MN9|rostrum',
    'probosc':  r'haustell|pharyng|proboscis|labell',
    'fdg':      r'Fdg|G2N|IN1',
}
cols = ['type', 'instance', 'receptorType', 'subclass']

print("\n=== dopasowania ===")
for name, p in pats.items():
    hits = set()
    for col in cols:
        s = a[col].dropna().astype(str)
        hits |= set(s[s.str.contains(p, case=False, regex=True)].unique())
    print(f"\n{name}: {len(hits)} unikalnych")
    for h in sorted(hits)[:25]:
        print("   ", h)
