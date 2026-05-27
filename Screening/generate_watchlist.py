import pandas as pd
import random
from faker import Faker

fake = Faker("en_IN")

rows = []

for i in range(1000):
    name = fake.name()
    first = name.split()[0]

    rows.append({
        "name": name,
        "alias": first + " " + fake.last_name(),
        "address": fake.address().replace("\n", ", "),
        "phone": fake.msisdn()[-10:],
        "phone2": fake.msisdn()[-10:],
        "email": fake.email(),
        "email2": f"{first.lower()}@outlook.com",
        "city": fake.city(),

        # UNIQUE IDS
        "pan": fake.bothify(text="?????####?").upper(),
        "aadhaar": str(random.randint(10**11, 10**12 - 1)),
        "passport": random.choice(["A", "B", "C"]) + str(random.randint(10**6, 10**7 - 1)),
        "voter_id": "V" + str(random.randint(1000000, 9999999)),
        "driving_license": "DL" + str(random.randint(1000000000000, 9999999999999)),

        # AML metadata
        "source": random.choice(["SEBI", "INTERPOL", "UN", "OFAC"]),
        "country": "India",
        "type": random.choice(["Individual", "Entity"]),
        "reason": random.choice([
            "Fraud",
            "Money Laundering",
            "Terror Financing",
            "Financial Crime"
        ]),
        "link": f"https://example.com/case/{i}"
    })

df = pd.DataFrame(rows)
df.to_csv("watchlist_1000.csv", index=False)

print("✅ watchlist_1000.csv generated")