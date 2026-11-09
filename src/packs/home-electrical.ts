import { definePack } from '../lib/define.ts';

// US residential wiring, NEC conventions throughout: 120/240 volt split-phase
// service, AWG sizes, copper branch circuits unless the question says
// otherwise. The title carries the region so nobody trained on another code
// gets failed by this one.

export default definePack({
  id: 'home-electrical',
  title: 'Home Electrical (US)',
  noun: 'electrician',
  category: 'trades',
  claim: 'I rewired half my house, I know my way around a panel',
  aliases: [
    'electrician',
    'electrical',
    'wiring',
    'house wiring',
    'residential electrical',
    'sparky',
    'breaker panel',
    'romex',
    'outlets',
    'gfci',
    'rewiring',
    'diy electrical',
    'journeyman',
    'multimeter',
  ],
  questions: [
    // ── Tier 1: warm-up ────────────────────────────────────────────────
    {
      tier: 1,
      kind: 'trap',
      ask: 'You switch off the main breaker and pull the panel cover to add a circuit. How much of what is in front of you is now dead?',
      right: 'All but the service wires and their lugs',
      wrong: [
        'All of it, once the branch breakers are off',
        'All of it. The main feeds everything in there',
        'All but the neutral bar and the grounds',
      ],
      bait: 1,
      why: 'The main only kills the bus below it. The service wires and the lugs they land on stay hot until power is cut upstream, usually by pulling the meter, and nothing out there will trip for you.',
    },
    {
      tier: 1,
      kind: 'math',
      ask: 'A dedicated 20 amp, 120 volt circuit will feed a bank of heat lamps that stay on around the clock. Under the NEC, how many watts of lamps can go on it?',
      right: '1,920 watts',
      wrong: ['2,400 watts', '1,440 watts', '1,800 watts'],
      bait: 0,
      why: 'Anything that runs three hours or more is a continuous load, and the NEC holds those to 80% of the breaker. Sixteen amps at 120 volts is 1,920.',
    },
    {
      tier: 1,
      kind: 'instinct',
      ask: 'The outlet on the back patio, a plain duplex, is dead. Nothing in the panel has tripped. What is your first guess?',
      right: 'A GFCI in the garage or a bath has tripped',
      wrong: [
        'A breaker has failed without tripping',
        'A push-in connection has burnt out upstream',
        'Weather has killed the patio outlet itself',
      ],
      bait: 2,
      why: 'Outdoor, garage and bathroom outlets often hang off one GFCI somewhere else in the house. Find the button that popped before you pick up a screwdriver.',
    },
    {
      tier: 1,
      kind: 'scar',
      ask: 'A 15 amp garage circuit trips whenever the table saw and the shop vac run together. The owner asks you to swap in a 20 amp breaker. What decides whether you can?',
      right: 'The gauge of the wire on that circuit',
      wrong: [
        'The amp rating stamped on the outlets',
        'The amp draw on the saw nameplate',
        'The spare capacity left in the panel',
      ],
      bait: 0,
      why: 'The breaker is there to protect the wire. On 12 gauge copper a 20 is fine. On 14 gauge it turns the cable in the wall into the fuse, and the real fix is a new circuit.',
    },

    // ── Tier 2: shop talk ──────────────────────────────────────────────
    {
      tier: 2,
      kind: 'trap',
      ask: '1950s house, two-wire cable, no ground in any box. The owner wants a three-prong outlet at the desk and will not pay for new cable. Under the NEC, what is your answer?',
      right: 'A GFCI outlet labeled no equipment ground',
      wrong: [
        'A GFCI outlet with its ground tied to neutral',
        'A three-prong outlet, ground screw left empty',
        'Nothing with three prongs until a ground is run',
      ],
      bait: 2,
      why: 'A GFCI trips when the current going out and coming back differ by about 5 milliamps. It never looks at the ground, so the NEC allows one on a two-wire circuit as long as it is labeled no equipment ground.',
    },
    {
      tier: 2,
      kind: 'math',
      ask: 'House on 120/240 volt single-phase service. A 12/3 cable on a two-pole 20 amp breaker feeds two circuits that share the white. The black is carrying 12 amps and the red is carrying 8. What is on the white?',
      right: '4 amps',
      wrong: ['20 amps', '12 amps', '0 amps'],
      bait: 0,
      why: 'On a multiwire circuit the two legs cancel in the shared neutral, so it carries only the difference. Land both hots on the same leg and it carries the sum, with no breaker watching it.',
    },
    {
      tier: 2,
      kind: 'scar',
      ask: 'Half the outlets in a bedroom went dead overnight. The rest of that circuit still works, and no GFCI or wall switch feeds the dead ones. What do you expect to find?',
      right: 'A burnt push-in connection at one outlet',
      wrong: [
        'A weak breaker dropping part of its load',
        'A loose neutral on the bar in the panel',
        'A cable chewed through inside the wall',
      ],
      bait: 2,
      why: 'Outlets are daisy-chained through each device, and the spring-clip backstabs are the weak point. Pull the last live outlet and the first dead one: the cooked connection is on one of them.',
    },
    {
      tier: 2,
      kind: 'scar',
      ask: 'You swap a worn living room receptacle for a new one, every wire back on the screw it came off. Now the lamp plugged into it ignores the wall switch and stays on. What did you miss?',
      right: 'Snapping the tab between the brass screws',
      wrong: [
        'Re-marking the white wire as a switched hot',
        'Buying a receptacle made for switched use',
        'Matching the amp rating of the old receptacle',
      ],
      bait: 1,
      why: 'A half-switched outlet has the tab on the hot side snapped off so the two halves are separate. A new receptacle ships with it intact, which ties the switched half to the always-hot one.',
    },

    // ── Tier 3: deep end ───────────────────────────────────────────────
    {
      tier: 3,
      kind: 'trap',
      ask: 'A landscaper has cut the bare copper wire that runs from the service to the ground rod. The owner asks what the house is missing until you fix it. What do you say?',
      right: 'Its path for shedding lightning and surges',
      wrong: [
        'Its path for tripping a breaker on a short',
        'Its return path for the neutral current',
        'Its shock protection on metal appliances',
      ],
      bait: 0,
      why: 'Faults clear through the ground wire back to the neutral at the service, not through dirt. Earth is a poor conductor: a rod might pass a few amps. The rod is there for lightning and to hold the system near earth voltage.',
    },
    {
      tier: 3,
      kind: 'math',
      ask: 'Plastic single-gang box, no internal clamps. Two 12/2 cables with ground come in and land on one receptacle. At 2.25 cubic inches per 12 gauge conductor, how much box volume does the NEC require?',
      right: '15.75 cubic inches',
      wrong: ['11.25 cubic inches', '20.25 cubic inches', '13.5 cubic inches'],
      bait: 2,
      why: 'Four insulated wires, one allowance for all the grounds, and two for the device: seven at 2.25. Count only the six wires you can see and you fail inspection with a box too small to fold them into.',
    },
    {
      tier: 3,
      kind: 'instinct',
      ask: 'A customer calls: whenever the microwave starts, the kitchen lights dim and the bedroom lights get brighter. What is your first suspect?',
      right: 'A failing neutral on the service',
      wrong: [
        'A loose hot leg at the main breaker',
        'An overloaded microwave circuit',
        'A surge coming in on the utility line',
      ],
      bait: 1,
      why: 'Lights that get brighter mean the neutral is loose or open, so the two legs are no longer held at 120 volts. One side sags while the other climbs. It cooks electronics and starts fires, so it does not wait.',
    },
    {
      tier: 3,
      kind: 'scar',
      ask: '1971 house with aluminum branch wiring. You are pigtailing a short copper lead onto the aluminum at every outlet and switch. What makes that splice?',
      right: 'Setscrew lugs listed for both metals',
      wrong: [
        'Standard wire nuts, twisted on extra tight',
        'Standard wire nuts over antioxidant paste',
        'Push-in connectors rated for solid wire',
      ],
      bait: 1,
      why: 'Aluminum pigtails only hold up in connectors listed for aluminum to copper. An ordinary wire nut on that joint loosens, oxidizes and cooks, paste or no paste, which can be worse than leaving the aluminum alone.',
    },
  ],
});
