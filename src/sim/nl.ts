// The Netherlands: the 40 largest municipalities with their four-digit postcode areas (from
// public postcode tables; a range a–b means every area number from a to b in that
// municipality), real streets in each, and the most common family names.
import type { City } from './countries';

const r = (s: string): [number, number][] =>
  s.split(',').map((p) => {
    const [a, b] = p.trim().split('-').map(Number);
    return [a!, b ?? a!];
  });

/** Largest first. */
export const NL_CITIES: City[] = [
  { name: 'Amsterdam', pop: 931, pc: r('1011-1098, 1101-1109') },
  { name: 'Rotterdam', pop: 664, pc: r('3011-3089') },
  { name: 'Den Haag', pop: 566, pc: r('2491-2498, 2511-2597') },
  { name: 'Utrecht', pop: 374, pc: r('3451-3455, 3511-3585') },
  { name: 'Eindhoven', pop: 246, pc: r('5611-5658') },
  { name: 'Groningen', pop: 243, pc: r('9711-9756') },
  { name: 'Tilburg', pop: 229, pc: r('5011-5049') },
  { name: 'Almere', pop: 226, pc: r('1309-1364') },
  { name: 'Breda', pop: 186, pc: r('4811-4841') },
  { name: 'Nijmegen', pop: 183, pc: r('6511-6546') },
  { name: 'Apeldoorn', pop: 167, pc: r('7311-7351') },
  { name: 'Arnhem', pop: 166, pc: r('6811-6846') },
  { name: 'Haarlemmermeer', pop: 162, pc: r('2131-2158') },
  { name: 'Haarlem', pop: 168, pc: r('2011-2037') },
  { name: 'Enschede', pop: 162, pc: r('7511-7548') },
  { name: 'Amersfoort', pop: 161, pc: r('3811-3829') },
  { name: 'Zaanstad', pop: 159, pc: r('1501-1509, 1521-1567') },
  { name: "'s-Hertogenbosch", pop: 160, pc: r('5211-5249') },
  { name: 'Zwolle', pop: 133, pc: r('8011-8045') },
  { name: 'Leiden', pop: 128, pc: r('2311-2334') },
  { name: 'Zoetermeer', pop: 127, pc: r('2711-2729') },
  { name: 'Leeuwarden', pop: 126, pc: r('8911-8941, 9001-9089') },
  { name: 'Maastricht', pop: 123, pc: r('6211-6229') },
  { name: 'Ede', pop: 122, pc: r('6711-6745') },
  { name: 'Dordrecht', pop: 121, pc: r('3311-3329') },
  { name: 'Alphen a/d Rijn', pop: 115, pc: r('2391-2409') },
  { name: 'Westland', pop: 115, pc: r('2291-2295, 2671-2694') },
  { name: 'Alkmaar', pop: 110, pc: r('1811-1831, 1841-1847') },
  { name: 'Emmen', pop: 108, pc: r('7811-7895') },
  { name: 'Delft', pop: 105, pc: r('2611-2629') },
  { name: 'Venlo', pop: 103, pc: r('5911-5951') },
  { name: 'Deventer', pop: 102, pc: r('7411-7437') },
  { name: 'Sittard-Geleen', pop: 91, pc: r('6121-6167') },
  { name: 'Helmond', pop: 94, pc: r('5701-5709') },
  { name: 'Oss', pop: 95, pc: r('5341-5398') },
  { name: 'Amstelveen', pop: 92, pc: r('1181-1189') },
  { name: 'Hilversum', pop: 92, pc: r('1211-1223') },
  { name: 'Súdwest-Fryslân', pop: 92, pc: r('8601-8775') },
  { name: 'Heerlen', pop: 87, pc: r('6411-6433') },
  { name: 'Nissewaard', pop: 87, pc: r('3201-3218') },
];

/** The most common Dutch surnames (after the national family name counts), most common first. */
export const NL_SURNAMES = [
  'de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer',
  'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer',
  'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer', 'van der Linden', 'Kok', 'Jacobs', 'de Haan', 'Vermeulen',
  'van den Heuvel', 'van der Veen', 'van den Broek', 'de Bruijn', 'de Bruin', 'van der Heijden', 'Schouten', 'van Beek', 'Willems', 'van Vliet',
  'van de Ven', 'Hoekstra', 'Maas', 'Verhoeven', 'Koster', 'van Dam', 'van der Wal', 'Prins', 'Blom', 'Huisman',
  'Peeters', 'de Jonge', 'Kuipers', 'van Veen', 'Post', 'Kuiper', 'Veenstra', 'Kramer', 'van den Brink', 'Scholten',
  'van Wijk', 'Postma', 'Martens', 'Vink', 'de Ruiter', 'Timmermans', 'Groen', 'Gerritsen', 'Jonker', 'van Loon',
  'Boer', 'van der Velde', 'Willemsen', 'Smeets', 'de Lange', 'de Vos', 'Bosch', 'van Dongen', 'Schipper', 'de Koning',
  'van der Laan', 'Koning', 'van der Velden', 'Driessen', 'van Doorn', 'Hermans', 'Evers', 'van den Bosch', 'van der Meulen', 'Hofman',
  'Bosman', 'Wolters', 'Sanders', 'van der Horst', 'Mol', 'Kuijpers', 'Molenaar', 'van de Pol', 'de Leeuw', 'Verbeek',
];

/** Real streets in each destination. */
export const NL_STREETS: Record<string, string[]> = {
  Amsterdam: ['Damrak', 'Kalverstraat', 'Prinsengracht', 'Keizersgracht', 'Overtoom', 'Ferdinand Bolstraat', 'Javastraat', 'Van Woustraat'],
  Rotterdam: ['Coolsingel', 'Witte de Withstraat', 'Nieuwe Binnenweg', 'Meent', 'Beijerlandselaan', 'Zwart Janstraat', 'Kralingse Plaslaan'],
  'Den Haag': ['Lange Voorhout', 'Frederik Hendriklaan', 'Laan van Meerdervoort', 'Prinsegracht', 'Weimarstraat', 'Thorbeckelaan'],
  Utrecht: ['Oudegracht', 'Biltstraat', 'Twijnstraat', 'Amsterdamsestraatweg', 'Nobelstraat', 'Kanaalstraat'],
  Eindhoven: ['Stratumseind', 'Kruisstraat', 'Woenselse Markt', 'Boschdijk', 'Aalsterweg', 'Hoogstraat'],
  Groningen: ['Oude Ebbingestraat', 'Herestraat', 'Nieuwe Ebbingestraat', 'Zuiderdiep', 'Korreweg', 'Paterswoldseweg'],
  Tilburg: ['Heuvelstraat', 'Piusstraat', 'Ringbaan-Oost', 'Korvelseweg', 'Goirkestraat', 'Bredaseweg'],
  Almere: ['Grote Markt', 'Stedenwijk', 'Hollandstraat', 'Kruidenwijk', 'Bergsmapad', 'Contrabasweg'],
  Breda: ['Ginnekenweg', 'Haagweg', 'Boschstraat', 'Ceresstraat', 'Baronielaan', 'Haven'],
  Nijmegen: ['Groesbeekseweg', 'Daalseweg', 'Hertogstraat', 'Graafseweg', 'Sint Annastraat', 'Molenstraat'],
  Apeldoorn: ['Hoofdstraat', 'Deventerstraat', 'Loolaan', 'Asselsestraat', 'Zwolseweg', 'Koninginnelaan'],
  Arnhem: ['Rijnkade', 'Steenstraat', 'Velperweg', 'Amsterdamseweg', 'Jansbinnensingel', 'Klarendalseweg'],
  Haarlemmermeer: ['Kruisweg', 'Hoofdweg', 'Burgemeester van Stamplein', 'Bennebroekerweg', 'Spoorlaan', 'Graan voor Visch'],
  Haarlem: ['Grote Houtstraat', 'Zijlweg', 'Kleverparkweg', 'Rijksstraatweg', 'Gedempte Oude Gracht', 'Schoterweg'],
  Enschede: ['Oldenzaalsestraat', 'Hengelosestraat', 'Haaksbergerstraat', 'Gronausestraat', 'Deurningerstraat', 'Kuipersdijk'],
  Amersfoort: ['Langestraat', 'Arnhemseweg', 'Utrechtseweg', 'Kamp', 'Leusderweg', 'Soesterweg'],
  Zaanstad: ['Gedempte Gracht', 'Westzijde', 'Oostzijde', 'Peperstraat', 'Vincent van Goghweg', 'Provincialeweg'],
  "'s-Hertogenbosch": ['Hinthamerstraat', 'Vughterstraat', 'Orthenseweg', 'Brugstraat', 'Graafseweg', 'Pettelaarseweg'],
  Zwolle: ['Diezerstraat', 'Assendorperstraat', 'Thomas a Kempisstraat', 'Wipstrikkerallee', 'Middelweg', 'Rieteweg'],
  Leiden: ['Breestraat', 'Haarlemmerstraat', 'Rapenburg', 'Hooigracht', 'Morsweg', 'Hoge Rijndijk'],
  Zoetermeer: ['Dorpsstraat', 'Meerzichtlaan', 'Amerikaweg', 'Europaweg', 'Bredewater', 'Boerhaavelaan'],
  Leeuwarden: ['Nieuwestad', 'Voorstreek', 'Tweebaksmarkt', 'Harlingerstraatweg', 'Valeriusstraat', 'Spanjaardslaan'],
  Maastricht: ['Rechtstraat', 'Wycker Brugstraat', 'Brusselsestraat', 'Tongerseweg', 'Akersteenweg', 'Meerssenerweg'],
  Ede: ['Grotestraat', 'Molenstraat', 'Stationsweg', 'Klinkenbergerweg', 'Bennekomseweg', 'Verlengde Maanderweg'],
  Dordrecht: ['Voorstraat', 'Wijnstraat', 'Burgemeester de Raadtsingel', 'Krispijnseweg', 'Dubbeldamseweg', 'Vrieseweg'],
  'Alphen a/d Rijn': ['Hooftstraat', 'Prins Bernhardlaan', 'Raadhuisstraat', 'Ridderveld', 'Hoorn', 'Van Boetzelaerstraat'],
  Westland: ['Herenstraat', 'Molenweg', 'Naaldwijkseweg', 'Laan van Wateringse Veld', 'Dorpskade', 'Sint Annastraat'],
  Alkmaar: ['Langestraat', 'Laat', 'Kennemerstraatweg', 'Bergerweg', 'Nassaulaan', 'Oudegracht'],
  Emmen: ['Hoofdstraat', 'Weerdingerstraat', 'Statenweg', 'Noordbargerstraat', 'Boslaan', 'Angelsloërdijk'],
  Delft: ['Oude Delft', 'Choorstraat', 'Westvest', 'Phoenixstraat', 'Papsouwselaan', 'Brasserskade'],
  Venlo: ['Lomstraat', 'Parade', 'Kaldenkerkerweg', 'Eindhovenseweg', 'Tegelseweg', 'Straelseweg'],
  Deventer: ['Brink', 'Lange Bisschopstraat', 'Brinkgreverweg', 'Zutphenseweg', 'Snipperlingsdijk', 'Rielerweg'],
  'Sittard-Geleen': ['Rosmolenstraat', 'Markt', 'Rijksweg Zuid', 'Leyenbroekerweg', 'Annastraat', 'Mauritslaan'],
  Helmond: ['Veestraat', 'Kerkstraat', 'Mierloseweg', 'Kanaaldijk', 'Brandevoortse Dreef', 'Europaweg'],
  Oss: ['Heuvel', 'Molenstraat', 'Kruisstraat', 'Berghemseweg', 'Kantsingel', 'Oijenseweg'],
  Amstelveen: ['Stadsplein', 'Amsterdamseweg', 'Van der Hooplaan', 'Keizer Karelweg', 'Bovenkerkerweg', 'Laan Nieuwer-Amstel'],
  Hilversum: ['Kerkstraat', 'Groest', 'Larenseweg', "'s-Gravelandseweg", 'Soestdijkerstraatweg', 'Vaartweg'],
  'Súdwest-Fryslân': ['Nieuwmarkt', 'Grootzand', 'Leeuwarderweg', 'Hemdijk', 'Oosterdijk', 'Westersingel'],
  Heerlen: ['Saroleastraat', 'Akerstraat', 'Geleenstraat', 'Kloosterweg', 'Ganzeweide', 'Valkenburgerweg'],
  Nissewaard: ['Spijkenisserbrug', 'Uitstraat', 'Hekelingseweg', 'Groene Kruisweg', 'Noordweg', 'Jan Campertstraat'],
};
