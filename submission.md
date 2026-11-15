# SkyZen

An in-flight passenger wellness and cabin crew coordination platform that generates customized wellness plans based on live bio-marker input and flight timeline.

## Prototype
Passenger Dashboard (Catherine): [Open dashboard](http://localhost:8000/passenger?seat=2A)
Passenger Dashboard (Stella): [Open dashboard](http://localhost:8000/passenger?seat=2K)
Cabin Crew Dashboard: [Open dashboard](http://localhost:8000/crew)

## Run locally
Install Python, then clone the codebase and start the backend:

```bash
git clone https://github.com/angelines1402-debug/SKYZEN-by-CX797.git
cd SKYZEN-by-CX797
python -m pip install fastapi uvicorn
python backend/skyzen_api.py
```

Leave the server running, then open a prototype link above in your browser. The
`localhost` links work on the computer running the backend. Press `Ctrl+C` in
the terminal to stop it.

## Codebase
https://github.com/angelines1402-debug/SKYZEN-by-CX797
