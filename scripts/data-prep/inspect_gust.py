import pandas as pd
a = pd.read_feather('data/raw/body-annotations-male-cns-v1.0-minconf-0.5.feather')

g = a[a['class'] == 'gustatory']
print("gustatory:", len(g))
for col in ['subclass', 'superclass', 'entryNerve', 'somaNeuromere', 'type', 'receptorType']:
    print(f"\n--- {col} ---")
    print(g[col].dropna().value_counts().head(20).to_string())

print("\n=== MN9 ===")
mn = a[a['type'].fillna('').str.match(r'^MN9')]
print(mn[['bodyId','type','instance','class','superclass','exitNerve','somaNeuromere']].to_string())

print("\n=== cb_motor: wszystkie typy ===")
print(a[a.superclass == 'cb_motor']['type'].dropna().value_counts().to_string())
