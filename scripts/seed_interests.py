"""Seed the backend Interest table from interests_seed.json.

The mobile app fetches interests from GET /api/interests/, so new interests
must be added in the backend database. Run this in the BACKEND repo:

  1. Copy this file and interests_seed.json into the backend project root
     (next to manage.py).
  2. Adjust the Interest import below to match the backend app
     (e.g. `from interests.models import Interest`).
  3. Run:  python manage.py shell < seed_interests.py

Existing interests are kept (matched by name, case-insensitive); only
missing ones are created, so it is safe to run more than once.
"""
import json
import os

# TODO: adjust to the backend app that defines the Interest model
from interests.models import Interest  # noqa: E402

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'interests_seed.json')
with open(path, encoding='utf-8') as f:
    catalog = json.load(f)

existing = {name.lower() for name in Interest.objects.values_list('name', flat=True)}
created = 0
for category, items in catalog.items():
    for item in items:
        if item['name'].lower() in existing:
            continue
        Interest.objects.create(name=item['name'], icon=item['icon'])
        existing.add(item['name'].lower())
        created += 1

print(f'Done: {created} interests created, {Interest.objects.count()} total.')
