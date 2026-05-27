import pandas as pd
import random
from faker import Faker
import string

fake = Faker("en_IN")

sources = ["OFAC", "UN", "EU", "SEBI", "INTERPOL"]
types = ["Individual", "Entity"]
reasons = [
    "Sanctions",
    "Fraud",
    "Terror Financing",
    "Market Manipulation",
    "Drug Trafficking",
    "Financial Crime"
]

# -----------------------------
# ID GENERATORS
# -----------------------------
def generate_pan():
    return "".join(random.choices(string.ascii_uppercase, k=5)) + \
           "".join(random.choices(string.digits, k=4)) + \
           random.choice(string.ascii_uppercase)

def generate_aadhaar():
    return "".join(random.choices(string.digits, k=12))

def generate_passport():
    letters = "".join(random.choices(string.ascii_uppercase, k=random.choice([1, 2])))
    numbers = "".join(random.choices(string.digits, k=random.choice([6, 7])))
    return letters + numbers

def generate_voter_id():
    return random.choice(["MH", "DL", "GJ", "RJ"]) + "".join(random.choices(string.digits, k=7))

def generate_dl():
    return random.choice(["MH", "DL", "GJ", "RJ"]) + "".join(random.choices(string.digits, k=13))

# -----------------------------
# GENERATE DATA
# -----------------------------
rows = []

for i in range(1000):
    entry_type = random.choice(types)

    if entry_type == "Individual":
        name = fake.name()
    else:
        name = fake.company()

    phone = "+91" + str(random.randint(6000000000, 9999999999))
    email = fake.email()
    address = fake.address().replace("\n", " ")
    city = fake.city()

    rows.append({
        # Non-unique
        "name": name,
        "address": address,
        "phone": phone,
        "email": email,
        "city": city,

        # Unique identifiers
        "pan": generate_pan(),
        "aadhaar": generate_aadhaar(),
        "passport": generate_passport(),
        "voter_id": generate_voter_id(),
        "driving_license": generate_dl(),

        # AML metadata
        "source": random.choice(sources),
        "country": fake.country(),
        "type": entry_type,
        "reason": random.choice(reasons),
        "alias": ""
    })

df = pd.DataFrame(rows)

# Optional: introduce some duplicates (realistic AML scenario)
for _ in range(50):
    idx = random.randint(0, 999)
    df.loc[idx, "name"] = df.loc[random.randint(0, 999), "name"]

df.to_csv("watchlist.csv", index=False)

print("✅ watchlist.csv generated with realistic AML structure")