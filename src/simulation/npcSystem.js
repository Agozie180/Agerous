/**
 * AGEROUS — NPC System
 *
 * Defines all NPCs and their behavioral rules.
 * NPCs are purely data + deterministic-rule-driven; no LLM involvement.
 *
 * DESIGN NOTE on randomness:
 *   All stochastic decisions (church attendance, evening socialising) are made
 *   ONCE and stored on the NPC as a personal preference flag.  tickNPC only
 *   re-evaluates the preference when the relevant world flag changes, not on
 *   every tick.  This prevents NPCs from flickering between states.
 */

import { LOCATION_IDS, NPC_ACTIVITY, WEATHER } from './worldState.js';

export const OCCUPATIONS = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  VENDOR:  'vendor',
  FARMER:  'farmer',
  PRIEST:  'priest',
  ELDER:   'elder',
  PARENT:  'parent',
  WORKER:  'worker',
};

/** Build the initial NPC roster */
export function createNPCs() {
  const npcs = {};

  const roster = [
    // Teachers
    { id: 'npc_01', name: 'Elena Reyes',    age: 38, occupation: OCCUPATIONS.TEACHER,  home: LOCATION_IDS.HOUSE_1, voter: true,  churchGoer: true  },
    { id: 'npc_02', name: 'James Okafor',   age: 44, occupation: OCCUPATIONS.TEACHER,  home: LOCATION_IDS.HOUSE_2, voter: true,  churchGoer: false },
    // Students
    { id: 'npc_03', name: 'Lucia Reyes',    age: 12, occupation: OCCUPATIONS.STUDENT,  home: LOCATION_IDS.HOUSE_1, voter: false, churchGoer: true  },
    { id: 'npc_04', name: 'Marco Diaz',     age: 13, occupation: OCCUPATIONS.STUDENT,  home: LOCATION_IDS.HOUSE_2, voter: false, churchGoer: false },
    { id: 'npc_05', name: 'Aisha Kamara',   age: 11, occupation: OCCUPATIONS.STUDENT,  home: LOCATION_IDS.HOUSE_3, voter: false, churchGoer: true  },
    { id: 'npc_06', name: 'Sam Torres',     age: 14, occupation: OCCUPATIONS.STUDENT,  home: LOCATION_IDS.HOUSE_4, voter: false, churchGoer: false },
    { id: 'npc_07', name: 'Priya Nair',     age: 12, occupation: OCCUPATIONS.STUDENT,  home: LOCATION_IDS.HOUSE_5, voter: false, churchGoer: true  },
    { id: 'npc_08', name: 'Eli Mensah',     age: 13, occupation: OCCUPATIONS.STUDENT,  home: LOCATION_IDS.HOUSE_3, voter: false, churchGoer: false },
    // Vendors / Market
    { id: 'npc_09', name: 'Rosa Valdez',    age: 45, occupation: OCCUPATIONS.VENDOR,   home: LOCATION_IDS.HOUSE_2, voter: true,  churchGoer: true  },
    { id: 'npc_10', name: 'David Kim',      age: 50, occupation: OCCUPATIONS.VENDOR,   home: LOCATION_IDS.HOUSE_4, voter: true,  churchGoer: false },
    { id: 'npc_11', name: 'Fatima Al-Amin', age: 35, occupation: OCCUPATIONS.VENDOR,   home: LOCATION_IDS.HOUSE_5, voter: true,  churchGoer: false },
    // Farmers
    { id: 'npc_12', name: 'Thomas Eze',     age: 55, occupation: OCCUPATIONS.FARMER,   home: LOCATION_IDS.HOUSE_3, voter: true,  churchGoer: true  },
    { id: 'npc_13', name: 'Clara Nkosi',    age: 48, occupation: OCCUPATIONS.FARMER,   home: LOCATION_IDS.HOUSE_1, voter: true,  churchGoer: true  },
    // Priest — always at church
    { id: 'npc_14', name: 'Father Gomez',   age: 62, occupation: OCCUPATIONS.PRIEST,   home: LOCATION_IDS.CHURCH,  voter: true,  churchGoer: true  },
    // Elders
    { id: 'npc_15', name: 'Grandma Yuki',   age: 78, occupation: OCCUPATIONS.ELDER,    home: LOCATION_IDS.HOUSE_1, voter: true,  churchGoer: true  },
    { id: 'npc_16', name: 'Old Man Bayo',   age: 73, occupation: OCCUPATIONS.ELDER,    home: LOCATION_IDS.HOUSE_2, voter: true,  churchGoer: true  },
    // Parents / Workers
    { id: 'npc_17', name: 'Sofia Cruz',     age: 33, occupation: OCCUPATIONS.PARENT,   home: LOCATION_IDS.HOUSE_4, voter: true,  churchGoer: true  },
    { id: 'npc_18', name: 'Ahmed Hassan',   age: 40, occupation: OCCUPATIONS.WORKER,   home: LOCATION_IDS.HOUSE_5, voter: true,  churchGoer: false },
    { id: 'npc_19', name: 'Grace Obi',      age: 29, occupation: OCCUPATIONS.WORKER,   home: LOCATION_IDS.HOUSE_3, voter: true,  churchGoer: true  },
    { id: 'npc_20', name: 'Luis Morales',   age: 36, occupation: OCCUPATIONS.WORKER,   home: LOCATION_IDS.HOUSE_2, voter: true,  churchGoer: false },
    { id: 'npc_21', name: 'Mei Lin',        age: 31, occupation: OCCUPATIONS.PARENT,   home: LOCATION_IDS.HOUSE_5, voter: true,  churchGoer: true  },
    { id: 'npc_22', name: 'Omar Siddiqui',  age: 42, occupation: OCCUPATIONS.WORKER,   home: LOCATION_IDS.HOUSE_1, voter: true,  churchGoer: false },
    { id: 'npc_23', name: 'Nina Petrov',    age: 27, occupation: OCCUPATIONS.WORKER,   home: LOCATION_IDS.HOUSE_4, voter: true,  churchGoer: false },
    { id: 'npc_24', name: 'Ben Adeyemi',    age: 60, occupation: OCCUPATIONS.ELDER,    home: LOCATION_IDS.HOUSE_3, voter: true,  churchGoer: true  },
    { id: 'npc_25', name: 'Lena Müller',    age: 32, occupation: OCCUPATIONS.PARENT,   home: LOCATION_IDS.HOUSE_2, voter: true,  churchGoer: true  },
  ];

  for (const def of roster) {
    npcs[def.id] = {
      ...def,
      location:       def.home,
      targetLocation: def.home,
      activity:       NPC_ACTIVITY.IDLE,
      money:          100 + Math.floor(Math.random() * 200),
      needs:          { food: 1.0, safety: 1.0, social: 0.8 },
      voted:          false,
      evacuated:      false,
      campaigning:    false,
      // 3D movement — managed by renderer
      worldPosition:       null,
      targetWorldPosition: null,
    };
  }

  return npcs;
}

/**
 * Human-readable label for an activity.
 */
export function activityLabel(activity) {
  const labels = {
    [NPC_ACTIVITY.IDLE]:         'Resting',
    [NPC_ACTIVITY.WORKING]:      'Working',
    [NPC_ACTIVITY.STUDYING]:     'Studying',
    [NPC_ACTIVITY.SHOPPING]:     'Shopping',
    [NPC_ACTIVITY.PRAYING]:      'At church',
    [NPC_ACTIVITY.VOTING]:       'Voting',
    [NPC_ACTIVITY.EVACUATING]:   'Evacuating!',
    [NPC_ACTIVITY.SHELTERING]:   'Taking shelter',
    [NPC_ACTIVITY.SLEEPING]:     'Sleeping',
    [NPC_ACTIVITY.TRAVELING]:    'Traveling',
    [NPC_ACTIVITY.CAMPAIGNING]:  'Campaigning',
    [NPC_ACTIVITY.STAYING_HOME]: 'Staying home',
  };
  return labels[activity] || activity;
}

/**
 * Determine where an NPC should be and what they should do,
 * based on the current world state.  Pure function — returns { location, activity }.
 *
 * Priority (highest first):
 *   1. Severe flood safety override
 *   2. Night (sleep)
 *   3. Election day voting
 *   4. Campaign activity
 *   5. Church service / priest duty
 *   6. School (weekday 8–15)
 *   7. Market (weekday 9–17)
 *   8. Farmer / worker daytime activity
 *   9. Evening socialising
 *  10. Home / idle
 */
export function computeNPCBehavior(npc, state) {
  const { hour, day, weather, flags, institutions, locations } = state;

  // ── 1. SAFETY: Severe flood ──────────────────────────────────────
  if (state.flood.active && state.flood.severity >= 2) {
    // Vulnerable groups (elders, students) → church shelter first
    const isVulnerable = npc.occupation === OCCUPATIONS.ELDER || npc.occupation === OCCUPATIONS.STUDENT;
    if (isVulnerable && locations[LOCATION_IDS.CHURCH].isShelter) {
      return { location: LOCATION_IDS.CHURCH, activity: NPC_ACTIVITY.SHELTERING };
    }
    // Home is safe if not flooded
    if (!locations[npc.home]?.flooded) {
      return { location: npc.home, activity: NPC_ACTIVITY.SHELTERING };
    }
    // Home flooded → go to church shelter
    if (locations[LOCATION_IDS.CHURCH].isShelter) {
      return { location: LOCATION_IDS.CHURCH, activity: NPC_ACTIVITY.SHELTERING };
    }
    // Last resort
    return { location: LOCATION_IDS.TOWN_SQUARE, activity: NPC_ACTIVITY.EVACUATING };
  }

  // Mild rain: vulnerable groups stay home
  if (weather === WEATHER.HEAVY_RAIN || weather === WEATHER.RAIN) {
    if (npc.occupation === OCCUPATIONS.ELDER || npc.occupation === OCCUPATIONS.STUDENT) {
      return { location: npc.home, activity: NPC_ACTIVITY.STAYING_HOME };
    }
  }

  // ── 2. NIGHT ─────────────────────────────────────────────────────
  if (hour >= 22 || hour < 6) {
    return { location: npc.home, activity: NPC_ACTIVITY.SLEEPING };
  }

  // ── 3. ELECTION DAY: unvoted eligible voters ─────────────────────
  if (flags.electionDay && npc.voter && !npc.voted) {
    if (locations[LOCATION_IDS.POLLING_STATION].accessible &&
        locations[LOCATION_IDS.POLLING_STATION].open) {
      return { location: LOCATION_IDS.POLLING_STATION, activity: NPC_ACTIVITY.VOTING };
    }
  }

  // ── 4. CAMPAIGN ──────────────────────────────────────────────────
  if (npc.campaigning && institutions.election.campaignActive) {
    return { location: LOCATION_IDS.TOWN_SQUARE, activity: NPC_ACTIVITY.CAMPAIGNING };
  }

  // ── 5. CHURCH SERVICE ────────────────────────────────────────────
  // Priest is always at church
  if (npc.occupation === OCCUPATIONS.PRIEST) {
    return { location: LOCATION_IDS.CHURCH, activity: NPC_ACTIVITY.WORKING };
  }
  // Church service: only churchGoers attend, only if accessible
  if (flags.churchService && npc.churchGoer && locations[LOCATION_IDS.CHURCH].accessible) {
    if (npc.occupation !== OCCUPATIONS.VENDOR && npc.occupation !== OCCUPATIONS.TEACHER) {
      return { location: LOCATION_IDS.CHURCH, activity: NPC_ACTIVITY.PRAYING };
    }
  }
  // Church shelter: vulnerable groups
  if (flags.churchShelter) {
    const isVulnerable = npc.occupation === OCCUPATIONS.ELDER || npc.occupation === OCCUPATIONS.STUDENT;
    if (isVulnerable) {
      return { location: LOCATION_IDS.CHURCH, activity: NPC_ACTIVITY.SHELTERING };
    }
  }

  // ── 6. SCHOOL: weekdays 8–15 ─────────────────────────────────────
  const isWeekday = (day % 7) < 5; // days 1–5 = Mon–Fri
  if (isWeekday && hour >= 8 && hour < 15) {
    if (!flags.schoolClosed && locations[LOCATION_IDS.SCHOOL].accessible) {
      if (npc.occupation === OCCUPATIONS.STUDENT) {
        return {
          location: LOCATION_IDS.SCHOOL,
          activity: flags.schoolExam ? NPC_ACTIVITY.STUDYING : NPC_ACTIVITY.STUDYING,
        };
      }
      if (npc.occupation === OCCUPATIONS.TEACHER) {
        return { location: LOCATION_IDS.SCHOOL, activity: NPC_ACTIVITY.WORKING };
      }
    }
    // School closed: students stay home
    if (flags.schoolClosed && npc.occupation === OCCUPATIONS.STUDENT) {
      return { location: npc.home, activity: NPC_ACTIVITY.STAYING_HOME };
    }
  }

  // ── 7. MARKET: weekdays 9–17 ─────────────────────────────────────
  if (isWeekday && hour >= 9 && hour < 17) {
    if (!flags.marketFlooded && locations[LOCATION_IDS.MARKET].accessible) {
      if (npc.occupation === OCCUPATIONS.VENDOR) {
        return { location: LOCATION_IDS.MARKET, activity: NPC_ACTIVITY.WORKING };
      }
      // Shoppers: workers/parents/farmers visit mid-morning
      if (hour >= 10 && hour < 13) {
        if ([OCCUPATIONS.WORKER, OCCUPATIONS.PARENT, OCCUPATIONS.FARMER].includes(npc.occupation)) {
          // Use NPC id as deterministic seed instead of Math.random()
          const seed = parseInt(npc.id.replace('npc_', ''), 10);
          if ((seed + state.day + state.hour) % 3 !== 0) {
            return { location: LOCATION_IDS.MARKET, activity: NPC_ACTIVITY.SHOPPING };
          }
        }
      }
    }
  }

  // ── 8. FARMER / WORKER: daytime activity ─────────────────────────
  if (npc.occupation === OCCUPATIONS.FARMER && hour >= 7 && hour < 17) {
    return { location: LOCATION_IDS.TOWN_SQUARE, activity: NPC_ACTIVITY.WORKING };
  }
  if (npc.occupation === OCCUPATIONS.WORKER && hour >= 8 && hour < 17) {
    return { location: LOCATION_IDS.TOWN_SQUARE, activity: NPC_ACTIVITY.WORKING };
  }

  // ── 9. EVENING SOCIALISING ────────────────────────────────────────
  if (hour >= 17 && hour < 21) {
    const seed = parseInt(npc.id.replace('npc_', ''), 10);
    if ((seed + state.day) % 3 === 0) {
      return { location: LOCATION_IDS.TOWN_SQUARE, activity: NPC_ACTIVITY.IDLE };
    }
  }

  // ── 10. DEFAULT: home ────────────────────────────────────────────
  return { location: npc.home, activity: NPC_ACTIVITY.IDLE };
}

/**
 * Run a single NPC behavior tick.  Mutates npc.location and npc.activity.
 */
export function tickNPC(npc, state) {
  const { location, activity } = computeNPCBehavior(npc, state);
  npc.location = location;
  npc.activity = activity;
}

/**
 * Update all NPCs and refresh institution counts.
 */
export function tickAllNPCs(state) {
  for (const id in state.npcs) {
    tickNPC(state.npcs[id], state);
  }
  _updateInstitutionCounts(state);
}

/**
 * Record that an NPC has voted (called by simulation engine when
 * the NPC arrives at the polling station on election day).
 */
export function castVoteIfEligible(npc, state) {
  if (!state.flags.electionDay) return;
  if (!npc.voter || npc.voted) return;
  if (npc.location !== LOCATION_IDS.POLLING_STATION) return;

  npc.voted = true;
  const election = state.institutions.election;
  // Cast vote based on candidate support probability
  if (Math.random() < election.candidates[0].support) {
    election.candidates[0].votes += 1;
  } else {
    election.candidates[1].votes += 1;
  }
  election.totalVotes += 1;
}

function _updateInstitutionCounts(state) {
  const npcs = Object.values(state.npcs);
  state.institutions.school.studentCount = npcs.filter(
    n => n.location === LOCATION_IDS.SCHOOL && n.occupation === OCCUPATIONS.STUDENT
  ).length;
  state.institutions.school.teacherCount = npcs.filter(
    n => n.location === LOCATION_IDS.SCHOOL && n.occupation === OCCUPATIONS.TEACHER
  ).length;
  state.institutions.market.vendorCount = npcs.filter(
    n => n.location === LOCATION_IDS.MARKET && n.occupation === OCCUPATIONS.VENDOR
  ).length;
  state.institutions.church.congregationCount = npcs.filter(
    n => n.location === LOCATION_IDS.CHURCH
  ).length;
}
