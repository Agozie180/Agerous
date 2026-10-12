"""Browser end-to-end: flows A (flood), B (election), C (invalid), D (persistence).
Usage: python3 e2e/run.py http://localhost:4173/ [shots_dir]"""
import sys, json, os
from playwright.sync_api import sync_playwright
url = sys.argv[1] + ('?play' if '?' not in sys.argv[1] else ''); shots = sys.argv[2] if len(sys.argv) > 2 else 'e2e/shots'
os.makedirs(shots, exist_ok=True)
errors = []; fails = []
def check(name, cond, info=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info != '' else ''))
    if not cond: fails.append(name)
def state(pg, js): return pg.evaluate(js)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    ctx = b.new_context(viewport={"width":1360,"height":800})
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.goto(url); pg.wait_for_function("window.agerous && window.agerous.world", timeout=15000); pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{shots}/01_normal_walk.png')
    check('A0 world boots at Day 1 morning', state(pg, "agerous.world.t >= 480 && agerous.world.t < 700"))
    pg.evaluate("agerous.player.toggleMode()"); pg.wait_for_timeout(600)
    pg.screenshot(path=f'{shots}/02_normal_sky.png')
    # ---- Flow A: flood via the real prompt box
    pg.fill('#prompt-input', 'A severe flood is coming'); pg.click('#prompt-go'); pg.wait_for_timeout(800)
    check('A1 interpretation card shown', 'flood' in pg.inner_text('#interp').lower(), pg.inner_text('#interp')[:80].replace('\n',' | '))
    check('A2 world has a rain event & forecast', state(pg, "agerous.world.env.peak") > 2.7)
    pg.evaluate("agerous.world.timeSpeed = 90"); pg.wait_for_timeout(9000)
    w = state(pg, "({stage: agerous.world.env.stage, school: agerous.world.institutions.school.open, market: agerous.world.institutions.market.open, shelters: agerous.world.institutions.civil.shelters, church: Object.values(agerous.world.npcs).filter(n=>n.location==='church').length})")
    check('A3 water rose', w['stage'] > 1.0, w['stage'])
    pg.screenshot(path=f'{shots}/03_flood_sky.png')
    pg.evaluate("agerous.player.toggleMode()"); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{shots}/04_flood_walk.png')
    pg.wait_for_timeout(9000)
    w = state(pg, "({stage: agerous.world.env.stage, school: agerous.world.institutions.school.open, market: agerous.world.institutions.market.open, shelters: agerous.world.institutions.civil.shelters, church: Object.values(agerous.world.npcs).filter(n=>n.location==='church').length})")
    check('A4 school closed by rule', w['school'] is False if isinstance(w['school'], bool) else not w['school'])
    check('A5 civil defence opened a shelter and people are in it', w['shelters'] == ['church'] and w['church'] >= 20, json.dumps(w))
    check('A6 history shows the causal chain', all(k in pg.inner_text('#history') for k in ['Evacuation ordered', 'shelter', 'School closed']))
    pg.screenshot(path=f'{shots}/05_flood_ui.png')
    # ---- Flow D: persistence
    pg.evaluate("agerous.world.timeSpeed = 0"); pg.wait_for_timeout(300)
    snap = state(pg, "({t: agerous.world.t, stage: +agerous.world.env.stage.toFixed(3), hist: agerous.world.history.length})")
    pg.reload(); pg.wait_for_function("window.agerous && window.agerous.world", timeout=15000); pg.wait_for_timeout(800)
    snap2 = state(pg, "({t: agerous.world.t, stage: +agerous.world.env.stage.toFixed(3), hist: agerous.world.history.length})")
    check('D1 reload restores clock, flood level and history', snap2['t'] == snap['t'] and abs(snap2['stage']-snap['stage'])<0.02 and snap2['hist'] >= snap['hist'], f'{snap} -> {snap2}')
    # ---- Flow C: invalid prompt leaves world unchanged
    pg.evaluate("agerous.world.timeSpeed = 0")
    before = state(pg, "JSON.stringify([agerous.world.env, agerous.world.institutions])")
    pg.fill('#prompt-input', 'summon a dragon over the church'); pg.click('#prompt-go'); pg.wait_for_timeout(600)
    after = state(pg, "JSON.stringify([agerous.world.env, agerous.world.institutions])")
    check('C1 unsupported prompt: useful error shown', 'flood' in pg.inner_text('#interp').lower() and "couldn't" in pg.inner_text('#interp').lower(), pg.inner_text('#interp')[:100].replace('\n',' | '))
    check('C2 unsupported prompt: world unchanged', before == after)
    # ---- Flow B: election on a fresh world
    pg.evaluate("localStorage.clear()"); pg.once("dialog", lambda d: d.accept()); pg.click('#btn-new'); pg.wait_for_timeout(500)
    pg.fill('#prompt-input', 'The local election is tomorrow'); pg.click('#prompt-go'); pg.wait_for_timeout(600)
    check('B1 election called', state(pg, "agerous.world.institutions.election.state") == 'campaign')
    pg.evaluate("agerous.world.timeSpeed = 360"); pg.wait_for_timeout(7000)
    pg.screenshot(path=f'{shots}/06_campaign_sky.png') if False else None
    for _ in range(70):
        if state(pg, "agerous.world.institutions.election.state") == 'done': break
        pg.wait_for_timeout(1000)
    pg.wait_for_timeout(800)
    r = state(pg, "agerous.world.elections.at(-1)")
    check('B2 election concluded with tally & turnout', bool(r) and r['total'] > 5, json.dumps(r))
    check('B3 result in history', 'wins the local election' in pg.inner_text('#history'))
    # ---- Flow E: build a structure from a sentence; Flow F: talk to a resident
    pg.evaluate("agerous.world.timeSpeed = 0")
    pg.fill('#prompt-input', 'build a levee around the church'); pg.click('#prompt-go'); pg.wait_for_timeout(800)
    check('E1 build event interpreted', 'build' in pg.inner_text('#interp').lower(), pg.inner_text('#interp')[:80].replace('\n',' | '))
    check('E2 defence stored in world state', state(pg, "agerous.world.defenses.church") == 1.0)
    pg.wait_for_timeout(2200)
    check('E3 3D structure exists in the scene', state(pg, "Object.keys(agerous.scene.defenseMeshes||{}).includes('church')"))
    pg.screenshot(path=f'{shots}/07_build.png')
    pg.evaluate("agerous.ui.npcCard(Object.values(agerous.world.npcs)[0], agerous.world)"); pg.wait_for_timeout(300)
    pg.fill('#npc-q', 'are you safe?'); pg.press('#npc-q', 'Enter'); pg.wait_for_timeout(800)
    check('F1 resident replies in character', len(pg.inner_text('#npc-reply')) > 10, pg.inner_text('#npc-reply')[:80])
    pg.evaluate("agerous.world.timeSpeed = 0")
    check('no console errors', not errors, '; '.join(errors[:3]))
    b.close()
print('\nFAILED:', fails if fails else 'none'); sys.exit(1 if fails else 0)
