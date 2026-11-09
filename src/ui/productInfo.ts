// Product information shown as an overlay card while the tour hovers at a stop
// (demo build). Keyed by tour-stop name (`Poi.name` in sorter.ts). Copy follows the
// vendor's product pages; `sim` says what the viewer is looking at in the hall.

export interface ProductBlock {
  name: string;
  text: string;
}

export interface StopInfo {
  /** Product family, shown above the title. */
  family: string;
  title: string;
  intro: string[];
  products: ProductBlock[];
  points: string[];
  /** What this stop shows in the sim. */
  sim: string;
}

export const STOP_INFO: Record<string, StopInfo> = {
  infeeds: {
    family: 'Sorting Orchestration Solutions',
    title: 'Workflow Manager',
    intro: [
      'Workflow Manager is an event-driven, configurable orchestration layer that connects sorting devices, cameras, barcode scanners, VMS and enrichment devices.',
      'It manages communication and coordination between systems and devices in real time, so all connected components operate as one integrated system.',
    ],
    products: [],
    points: [
      'Reliable operations: stable, continuous coding and sorting workflows',
      'Real-time identification of pieces based on configurable barcode definitions',
      'Flexible deployment, from large sorting environments to compact automation setups',
    ],
    sim: 'Four infeed lanes feed the loop on the beat; when parcels arrive faster than the lanes take them, they queue at the buffers.',
  },
  'scan tunnels': {
    family: 'Vision AI Solutions',
    title: 'Scanning',
    intro: [
      'Accurately recognize parcels, objects and data with proven AI. Every parcel is identified on its way into the sorter, even when the label is hard to read.',
    ],
    products: [
      {
        name: 'Enhanced Barcode Reader',
        text: 'Performs a second attempt when the primary scanner fails, analysing parcel images to recover barcodes standard scanners missed.',
      },
      {
        name: 'Address Recognition',
        text: 'Reads handwritten and machine-printed addresses and extracts street, house number, postal code and city, so parcels are routed without manual intervention.',
      },
    ],
    points: [
      'No-read recovery and reduced manual coding',
      'Reliable fallback identification when barcode scanning fails',
      'Seamless integration with existing sorting machines',
    ],
    sim: 'Each lane passes a scan tunnel that reads, measures and weighs the parcel; two more scanners on the loop recover some of the no-reads.',
  },
  loop: {
    family: 'Sorting Orchestration Solutions',
    title: 'Dynamic Sorting Decision System',
    intro: [
      'The central decision engine that determines how parcels, luggage and other items move through the sorting network.',
      'It manages shipment flows and sorting rules from one central system, and connects machines and devices from different suppliers through one Sorting API.',
    ],
    products: [],
    points: [
      'Real-time decision-making: the right sorting outcome for every item',
      'Routing logic adapted within minutes, with zero downtime',
      'OEM-agnostic integration and flexible multi-site sort plans',
      'Sorting decisions reported back to the business applications',
    ],
    sim: 'Every tray asks: which chute for this postcode? Is it full? Then to the buffer store, round again, or after three rounds to manual sorting.',
  },
  chutes: {
    family: 'Sorting Orchestration Solutions',
    title: 'Sorting Data Manager',
    intro: [
      'The central master data hub for coding and sorting systems across the logistics network.',
      'It imports, compiles and distributes the reference data that coding, sorting and enrichment systems need. Sort plans are created, edited and distributed to connected sorting systems.',
    ],
    products: [],
    points: [
      'A single source of truth for master data across the network',
      'Sort plan management: create, edit and export sort plans',
      'Automatic synchronization with business systems',
      'Options for automatic chute mapping, sorting simulation and sort plan optimization',
    ],
    sim: 'The sort plan maps every postcode range to a chute: big cities get several dock doors, shared out by volume.',
  },
  docks: {
    family: 'Flexible Sorting Solutions',
    title: 'Projection Sorting',
    intro: [
      'Projection Sorting, powered by the Flow Projector, guides workers during manual sorting by projecting visual instructions directly onto parcels or sorting locations.',
      'In high-volume environments, manual sorting can lead to errors when workers must quickly interpret routing information. Visual guidance improves both accuracy and speed.',
    ],
    products: [],
    points: [
      'Clear sorting instructions projected onto parcels or destinations',
      'Fewer sorting errors',
      'Faster sorting: no need to check screens or handheld devices',
      'Easy integration with existing sorting systems and routing logic',
    ],
    sim: 'Above each dock belt a projector shows the postcodes of the next parcels; the worker walks each one to the right roll cage.',
  },
  'pickup stations': {
    family: 'Flexible Sorting Solutions',
    title: 'Robotic Sorting',
    intro: [
      'Robotic Sorting uses autonomous mobile robots to automate parcel sorting in flexible and scalable logistics environments.',
      'Traditional sorting operations often rely on fixed infrastructure that is difficult to adapt when volumes fluctuate. Robotic Sorting replaces static systems with intelligent robots that transport and sort parcels dynamically across the sorting floor.',
    ],
    products: [],
    points: [
      'Rapid deployment, without major infrastructure changes',
      'Reduced labor dependency: manual sorting tasks automated',
      'Versatile handling of parcels, NMOs, tubes and other non-standard items',
    ],
    sim: 'Chutes from the loop end at long pickup tables. A robot takes the next parcel, the projector shows its postcode, and off it goes.',
  },
  bins: {
    family: 'Flexible Sorting Solutions',
    title: 'A fleet that scales',
    intro: [
      'With robots instead of fixed conveyors, the sorting floor itself becomes flexible: destinations can be added, moved or re-planned without rebuilding the hall.',
      'Capacity grows with the fleet. Need more throughput for the peak? Add robots.',
    ],
    products: [
      {
        name: 'Robotic Sorting',
        text: 'Autonomous mobile robots that transport and sort parcels dynamically across the sorting floor, for highly flexible and future-proof operations.',
      },
    ],
    points: [
      'Flexible sorting infrastructure: sorting in virtually any existing location, without fixed conveyor systems',
      'Scalable sorting capacity: increase throughput by simply adding robots',
      'Real-time adaptability to changing sorting requirements',
    ],
    sim: 'The robot floor is a grid with one-way lanes. Each robot reserves its path cell by cell, drives to the box for its postcode, tips the parcel in and parks.',
  },
  robot: {
    family: 'Edge AI Platform',
    title: 'Edge Platform',
    intro: [
      'The Edge Platform runs directly at the edge, close to cameras, sensors and machines within the sorting environment.',
      'Applications and operational services run inside the sorting facility, near the equipment that generates the data. Time-critical decisions happen immediately, and operations continue even when the connection to central or cloud systems is limited.',
    ],
    products: [],
    points: [
      'Ultra-low latency for immediate operational responses',
      'On-site decision-making where the data is generated',
      'Local resilience: sorting continues when the network is disrupted',
      'Optimized for AI models, robotics control and other time-sensitive processes',
    ],
    sim: 'You are riding along: every beat this robot gets its next move, steering around the others to its box and back to the pickup tables.',
  },
  'manual sorting': {
    family: 'Vision AI Solutions',
    title: 'Exceptions',
    intro: [
      'Even in highly automated operations, some parcels need a person: missing data, unreadable labels, irregular shapes or operational exceptions.',
    ],
    products: [
      {
        name: 'Video Coding',
        text: 'Lets operators interpret parcel information from images when automated recognition cannot, with smart-keying assistance, address databases and built-in quality control.',
      },
      {
        name: 'Manual Workstation',
        text: 'Gives operators the tools and guidance to process exceptions quickly and accurately, with parcel images, identifiers and operational data in one interface.',
      },
    ],
    points: [
      'Coding locally, centrally, in the cloud or offshore',
      'Operator-guided workflows and training modes',
      'Directly connected to sorting, coding and identification systems',
    ],
    sim: 'Parcels the loop could not sort are brought here by robot; a worker sorts them into pigeonholes.',
  },
  'control room': {
    family: 'Operational Intelligence Solutions',
    title: 'Process Monitor',
    intro: [
      'Real-time visibility into sorting operations, so processes run efficiently and reliably.',
      'By continuously tracking data across machines, systems and processes, operators detect deviations and respond before they affect sorting performance.',
    ],
    products: [
      {
        name: 'Data Analytics',
        text: 'Turns historical and operational data into insights: reports, patterns and inefficiencies, and simulation of changes to the sort plan.',
      },
    ],
    points: [
      'Live view of machine status, throughput and parcel flow',
      'Early detection of disruptions',
      'Dashboards with the key performance indicators',
    ],
    sim: 'The video wall shows chute fill, cleardowns, trucks, robots and the infeed queue; the Hub figures hold every KPI and a CSV export.',
  },
  'loop ride': {
    family: 'Operational Intelligence Solutions',
    title: 'Simulation & Digital Twin',
    intro: [
      'Test and optimize sorting operations in a virtual environment before implementing changes in the real world.',
      'By modelling the behaviour of a sorting facility, layouts, configurations and operational strategies can be evaluated in advance, for data-driven planning and investment decisions.',
    ],
    products: [],
    points: [
      'Throughput analysis of different configurations',
      'Scenario testing: volume peaks, equipment failures, process changes',
      'Bottleneck identification in parcel flow',
      'Layout and workflow optimization',
    ],
    sim: 'This hall is such a model: parcels, trays, robots, workers and trucks all follow the same sort plan and timetable.',
  },
};

/** Seconds needed to read a card (about 3.5 words per second, at least 14 s). */
export function readSeconds(info: StopInfo): number {
  const text = [info.title, ...info.intro, ...info.products.flatMap((p) => [p.name, p.text]), ...info.points, info.sim].join(' ');
  const words = text.split(/\s+/).length;
  return Math.max(14, Math.round(words / 3.5) + 4);
}
