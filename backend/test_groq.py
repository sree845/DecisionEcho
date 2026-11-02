import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise ValueError(
        "GROQ_API_KEY was not found. Check your .env file."
    )

client = Groq(api_key=api_key)

response = client.chat.completions.create(
    model="openai/gpt-oss-20b",
    messages=[
        {
            "role": "system",
            "content": (
                "You are DecisionEcho, a decision-reflection assistant. "
                "You do not provide investment recommendations. "
                "You only help users critically examine their reasoning."
            )
        },
        {
            "role": "user",
            "content": (
                "I am considering investing in a company because "
                "its revenue has grown rapidly for the last three years."
            )
        }
    ]
)

print("\n===== GROQ RESPONSE =====\n")
print(response.choices[0].message.content)