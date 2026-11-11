// The countries the hub can serve. Each has its 40 largest towns or municipalities
// (largest first) with inhabitants and postcode ranges, common family and first
// names, street names, and its own way of writing postcodes and addresses.
// Postcodes are kept as numbers (the sorter routes on number ranges) and written
// out per country (leading zeros, "111 22", "MD-2001").
//
// The country is chosen in the settings (stored with them); without a choice, the
// browser's language and region decide. Changing it reloads the page, since docks,
// cages, boxes and signs are all labelled when the hall is built.
import { NL_CITIES, NL_STREETS, NL_SURNAMES } from './nl';

export interface City {
  name: string;
  /** Inhabitants, in thousands (rounded): post goes out in proportion. */
  pop: number;
  /** Postcode areas, as [from, to] ranges (inclusive). */
  pc: [number, number][];
  /** State or region, where the address needs it (Australia). */
  region?: string;
  /** Uses the second street list (French-speaking Belgium). */
  alt?: boolean;
}

export type CountryId = 'nl' | 'be' | 'fr' | 'de' | 'fi' | 'se' | 'md' | 'in' | 'au';

export interface Country {
  id: CountryId;
  /** Its name in English, and in its own language. */
  name: string;
  native: string;
  cities: City[];
  /** Digits in a postcode (leading zeros are written). */
  digits: number;
  /** Postcodes in use are multiples of this (Finland: 00100, 00120, …). */
  step: number;
  surnames: string[];
  /** First names (empty: initials, as on Dutch labels). */
  first: string[];
  /** Street names used in every town (when a town has no list of its own). */
  streets: string[];
  streets2?: string[];
  /** Real streets per town, where known. */
  townStreets?: Record<string, string[]>;
}

/** Parses "1011-1098, 1101" into ranges. */
export const r = (s: string): [number, number][] =>
  s.split(',').map((p) => {
    const [a, b] = p.trim().split('-').map(Number);
    return [a!, b ?? a!];
  });

/** "Name|thousands|ranges|region" entries, separated by ";". A "*" before the name marks `alt`. */
const towns = (s: string): City[] =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [n, pop, pc, region] = x.split('|');
      const alt = n!.startsWith('*');
      return { name: alt ? n!.slice(1) : n!, pop: Number(pop), pc: r(pc!), ...(region ? { region } : {}), ...(alt ? { alt } : {}) };
    });

const words = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export const COUNTRIES: Country[] = [
  {
    id: 'nl',
    name: 'Netherlands',
    native: 'Nederland',
    cities: NL_CITIES,
    digits: 4,
    step: 1,
    surnames: NL_SURNAMES,
    first: [],
    streets: ['Dorpsstraat', 'Kerkstraat', 'Molenweg', 'Stationsweg', 'Schoolstraat'],
    townStreets: NL_STREETS,
  },
  {
    id: 'be',
    name: 'Belgium',
    native: 'België / Belgique',
    cities: towns(`
      Antwerpen|562|2000, 2018, 2020, 2030, 2040, 2050, 2060, 2100, 2140, 2170, 2180, 2600, 2610, 2660;
      Gent|273|9000, 9030-9032, 9040-9042, 9050-9052;
      *Charleroi|206|6000-6001, 6010, 6020, 6030-6032, 6040-6044, 6060-6061;
      Brussel|198|1000, 1020, 1120, 1130;
      *Liège|197|4000, 4020, 4030-4032;
      *Schaerbeek|130|1030;
      *Anderlecht|129|1070;
      Brugge|120|8000, 8200, 8310, 8380;
      *Namur|115|5000-5004, 5020-5022, 5024, 5100-5101;
      Leuven|105|3000-3001, 3010, 3012, 3018;
      *Molenbeek|99|1080;
      *Mons|97|7000, 7010-7012, 7020-7022, 7024, 7030-7034;
      Aalst|92|9300, 9308, 9310, 9320;
      Mechelen|90|2800-2801, 2811-2812;
      Hasselt|90|3500-3501, 3510-3512;
      *Ixelles|88|1050;
      Beveren|88|9120, 9130;
      *Uccle|87|1180;
      Sint-Niklaas|83|9100, 9111-9112;
      *La Louvière|82|7100, 7110;
      Kortrijk|81|8500-8501, 8510-8511;
      Oostende|73|8400;
      *Tournai|69|7500-7504, 7506, 7520-7522, 7530-7534, 7536, 7538, 7540, 7542-7543, 7548;
      Genk|68|3600;
      Roeselare|67|8800;
      *Seraing|65|4100-4102;
      *Woluwe-Saint-Lambert|61|1200;
      *Mouscron|60|7700, 7711-7712;
      *Forest|59|1190;
      *Verviers|56|4800-4802;
      *Jette|54|1090;
      Lokeren|51|9160;
      *Saint-Gilles|49|1060;
      *Etterbeek|49|1040;
      Beringen|49|3580-3583;
      Dendermonde|48|9200;
      Turnhout|48|2300;
      Vilvoorde|48|1800;
      Dilbeek|45|1700-1703;
      Sint-Truiden|42|3800, 3803, 3806`),
    digits: 4,
    step: 1,
    surnames: words(
      'Peeters, Janssens, Maes, Jacobs, Mertens, Willems, Claes, Goossens, Wouters, De Smet, Dubois, Lambert, Dupont, Martin, Hermans, Aerts, Desmet, Van den Broeck, Leroy, Michiels, Pauwels, Vermeulen, Peters, De Clercq, Simon, Laurent, Dumont, Lemaire, Van Damme, Cools, Smets, Declercq, Stevens, Verstraete, Wuyts, Lejeune, Renard, Leclercq, De Backer, Coppens, Martens, Segers, Hendrickx, Van de Velde, Bogaerts, Lambrechts, Thys, Gerard, François, Charlier',
    ),
    first: words('Jan, Marc, Luc, Pieter, Tom, Koen, Bart, Wim, Sofie, An, Els, Lien, Jean, Pierre, Michel, Philippe, Marie, Nathalie, Isabelle, Julie, Emma, Louis, Noah, Arthur, Olivia, Lucas, Elise, Lotte, Nina, Thomas'),
    streets: words('Kerkstraat, Stationsstraat, Dorpstraat, Molenstraat, Nieuwstraat, Schoolstraat, Kapelstraat, Beekstraat, Veldstraat, Lindenlaan, Kasteelstraat, Statiestraat, Brugstraat, Markt, Grote Markt'),
    streets2: words("Rue de la Station, Rue de l'Église, Rue du Moulin, Rue Haute, Rue Neuve, Rue de la Gare, Avenue des Combattants, Chaussée de Bruxelles, Rue du Centre, Rue des Écoles, Place Communale, Rue Royale, Avenue Louise, Rue de Namur, Rue du Château"),
  },
  {
    id: 'fr',
    name: 'France',
    native: 'France',
    cities: towns(`
      Paris|2104|75001-75020, 75116;
      Marseille|886|13001-13016;
      Lyon|519|69001-69009;
      Toulouse|515|31000, 31100, 31200, 31300, 31400, 31500;
      Nice|358|6000, 6100, 6200, 6300;
      Nantes|328|44000, 44100, 44200, 44300;
      Montpellier|310|34000, 34070, 34080, 34090;
      Strasbourg|294|67000, 67100, 67200;
      Bordeaux|268|33000, 33100, 33200, 33300, 33800;
      Lille|238|59000, 59160, 59260, 59777, 59800;
      Rennes|231|35000, 35200, 35700;
      Toulon|179|83000, 83100, 83200;
      Reims|178|51100;
      Saint-Étienne|173|42000, 42100;
      Le Havre|167|76600, 76610, 76620;
      Villeurbanne|164|69100;
      Dijon|162|21000;
      Angers|159|49000, 49100;
      Grenoble|156|38000, 38100;
      Nîmes|152|30000, 30900;
      Aix-en-Provence|150|13080, 13090, 13100, 13290, 13540;
      Saint-Denis|149|93200, 93210;
      Clermont-Ferrand|146|63000, 63100;
      Le Mans|146|72000, 72100;
      Brest|142|29200;
      Tours|139|37000, 37100, 37200;
      Amiens|136|80000, 80080, 80090;
      Annecy|132|74000, 74370, 74600, 74940, 74960;
      Limoges|130|87000, 87100, 87280;
      Metz|123|57000, 57050, 57070;
      Perpignan|122|66000, 66100;
      Boulogne-Billancourt|119|92100;
      Besançon|118|25000;
      Rouen|118|76000, 76100;
      Orléans|116|45000, 45100;
      Montreuil|112|93100;
      Caen|109|14000;
      Argenteuil|106|95100;
      Mulhouse|105|68100, 68200;
      Nancy|104|54000, 54100`),
    digits: 5,
    step: 1,
    surnames: words(
      'Martin, Bernard, Thomas, Petit, Robert, Richard, Durand, Dubois, Moreau, Laurent, Simon, Michel, Lefebvre, Leroy, Roux, David, Bertrand, Morel, Fournier, Girard, Bonnet, Dupont, Lambert, Fontaine, Rousseau, Vincent, Muller, Lefèvre, Faure, André, Mercier, Blanc, Guérin, Boyer, Garnier, Chevalier, François, Legrand, Gauthier, Garcia, Perrin, Robin, Clément, Morin, Nicolas, Henry, Roussel, Mathieu, Gautier, Masson',
    ),
    first: words('Jean, Pierre, Michel, Philippe, Nicolas, Julien, Thomas, Antoine, Christophe, Laurent, Marie, Nathalie, Isabelle, Sophie, Sylvie, Céline, Camille, Léa, Chloé, Manon, Lucas, Hugo, Louis, Gabriel, Emma, Jade, Louise, Alice, Inès, Arthur'),
    streets: words("Rue de la République, Rue Victor Hugo, Avenue Jean Jaurès, Rue Pasteur, Rue de la Gare, Boulevard Gambetta, Rue du Général de Gaulle, Place de la Mairie, Rue Jules Ferry, Avenue de la Libération, Rue Nationale, Rue de l'Église, Rue des Écoles, Rue du Moulin, Rue Émile Zola, Avenue Foch, Rue Carnot, Rue Voltaire"),
  },
  {
    id: 'de',
    name: 'Germany',
    native: 'Deutschland',
    cities: towns(`
      Berlin|3677|10115-10999, 12043-12689, 13051-13629, 14050-14199;
      Hamburg|1906|20095-22769;
      München|1488|80331-81929;
      Köln|1073|50667-51149;
      Frankfurt am Main|759|60306-60599, 65929-65936;
      Stuttgart|626|70173-70629;
      Düsseldorf|619|40210-40629;
      Leipzig|602|4103-4357;
      Dortmund|587|44135-44388;
      Essen|579|45127-45359;
      Bremen|563|28195-28779;
      Dresden|555|1067-1328;
      Hannover|536|30159-30669;
      Nürnberg|511|90402-90491;
      Duisburg|495|47051-47279;
      Bochum|363|44787-44894;
      Wuppertal|355|42103-42399;
      Bielefeld|334|33602-33739;
      Bonn|332|53111-53229;
      Münster|318|48143-48167;
      Mannheim|312|68159-68309;
      Karlsruhe|307|76131-76229;
      Augsburg|296|86150-86199;
      Wiesbaden|279|65183-65207;
      Mönchengladbach|261|41061-41239;
      Gelsenkirchen|260|45879-45899;
      Aachen|249|52062-52080;
      Braunschweig|249|38100-38126;
      Kiel|246|24103-24159;
      Chemnitz|243|9111-9247;
      Halle (Saale)|238|6108-6132;
      Magdeburg|236|39104-39130;
      Freiburg im Breisgau|232|79098-79117;
      Krefeld|227|47798-47839;
      Mainz|218|55116-55131;
      Lübeck|216|23552-23570;
      Erfurt|213|99084-99099;
      Oberhausen|209|46045-46149;
      Rostock|208|18055-18147;
      Kassel|200|34117-34134`),
    digits: 5,
    step: 1,
    surnames: words(
      'Müller, Schmidt, Schneider, Fischer, Weber, Meyer, Wagner, Becker, Schulz, Hoffmann, Schäfer, Koch, Bauer, Richter, Klein, Wolf, Schröder, Neumann, Schwarz, Zimmermann, Braun, Krüger, Hofmann, Hartmann, Lange, Schmitt, Werner, Schmitz, Krause, Meier, Lehmann, Schmid, Schulze, Maier, Köhler, Herrmann, König, Walter, Mayer, Huber, Kaiser, Fuchs, Peters, Lang, Scholz, Möller, Weiß, Jung, Hahn, Schubert',
    ),
    first: words('Thomas, Michael, Andreas, Stefan, Peter, Wolfgang, Klaus, Jürgen, Frank, Markus, Sabine, Petra, Andrea, Claudia, Monika, Susanne, Birgit, Julia, Anna, Laura, Lukas, Leon, Jonas, Felix, Maximilian, Paul, Lena, Lea, Hannah, Mia'),
    streets: words('Hauptstraße, Schulstraße, Gartenstraße, Bahnhofstraße, Dorfstraße, Bergstraße, Birkenweg, Lindenstraße, Kirchstraße, Waldstraße, Ringstraße, Schillerstraße, Goethestraße, Am Sportplatz, Wiesenweg, Mühlenweg, Rosenstraße, Feldstraße, Poststraße, Friedrichstraße'),
  },
  {
    id: 'fi',
    name: 'Finland',
    native: 'Suomi',
    cities: towns(`
      Helsinki|687|100-990;
      Espoo|322|2100-2380, 2600-2980;
      Tampere|260|33100-33450, 33500-33960;
      Vantaa|252|1200-1770;
      Oulu|216|90100-90940;
      Turku|206|20100-20960;
      Jyväskylä|149|40100-40950;
      Kuopio|126|70100-70940;
      Lahti|121|15100-15980;
      Pori|83|28100-28900;
      Joensuu|79|80100-82730;
      Kouvola|78|45100-47910;
      Lappeenranta|73|53100-54920;
      Vaasa|70|65100-65380;
      Hämeenlinna|68|13100-14840;
      Seinäjoki|67|60100-60800;
      Rovaniemi|66|96100-97890;
      Mikkeli|52|50100-50970;
      Porvoo|52|6100-6850;
      Salo|51|24100-25870;
      Kotka|50|48100-48910;
      Kokkola|48|67100-67800;
      Hyvinkää|47|5800-5880;
      Järvenpää|47|4400-4480;
      Lohja|46|8100-8700;
      Nurmijärvi|45|1900-1940;
      Kirkkonummi|42|2400-2490;
      Tuusula|42|4300-4380;
      Rauma|39|26100-26930;
      Kerava|38|4200-4260;
      Kajaani|37|87100-88900;
      Nokia|36|37100-37150;
      Ylöjärvi|34|33470-33480, 34240-34300;
      Kangasala|34|36200-36280;
      Savonlinna|31|57100-58900;
      Vihti|29|3100-3790;
      Riihimäki|29|11100-11910;
      Raasepori|27|10300-10820;
      Imatra|25|55100-55920;
      Sastamala|23|38200-38300`),
    digits: 5,
    step: 10,
    surnames: words(
      'Korhonen, Virtanen, Mäkinen, Nieminen, Mäkelä, Hämäläinen, Laine, Heikkinen, Koskinen, Järvinen, Lehtonen, Lehtinen, Saarinen, Salminen, Heinonen, Niemi, Heikkilä, Kinnunen, Salonen, Turunen, Salo, Laitinen, Tuominen, Rantanen, Karjalainen, Jokinen, Mattila, Savolainen, Lahtinen, Ahonen',
    ),
    first: words('Juha, Timo, Matti, Mikko, Kari, Jari, Antti, Pekka, Mika, Ville, Jukka, Markku, Anne, Tuula, Päivi, Anna, Maria, Laura, Sanna, Johanna, Riitta, Aino, Eino, Onni, Leevi, Elias, Helmi, Emilia, Venla, Aada'),
    streets: words('Koulukatu, Kirkkokatu, Asemakatu, Kauppakatu, Rantatie, Puistokatu, Hämeenkatu, Satamakatu, Myllytie, Kuusitie, Koivukuja, Mäntytie, Teollisuuskatu, Rautatienkatu, Torikatu, Linnankatu, Kalevankatu, Aleksanterinkatu'),
  },
  {
    id: 'se',
    name: 'Sweden',
    native: 'Sverige',
    cities: towns(`
      Stockholm|999|11120-11799, 12030-12999;
      Göteborg|613|41101-41879;
      Malmö|368|21111-21779;
      Uppsala|250|75217-75758;
      Linköping|169|58183-58758;
      Västerås|161|72130-72598;
      Örebro|161|70210-70382;
      Helsingborg|153|25220-25669;
      Jönköping|148|55302-55628;
      Norrköping|145|60002-60597;
      Huddinge|145|14100-14199;
      Umeå|135|90325-90790;
      Lund|132|22100-22738;
      Borås|115|50330-50764;
      Nacka|114|13130-13169;
      Eskilstuna|107|63002-63549;
      Halmstad|106|30230-30296;
      Gävle|104|80250-80649;
      Södertälje|103|15130-15259;
      Haninge|101|13630-13699;
      Sundsvall|99|85230-85753;
      Växjö|99|35230-35596;
      Karlstad|99|65219-65639;
      Botkyrka|97|14530-14799;
      Järfälla|90|17530-17777;
      Kristianstad|86|29130-29199;
      Kungsbacka|86|43430-43499;
      Solna|86|16929-17199;
      Luleå|80|97231-97598;
      Täby|79|18311-18779;
      Sollentuna|78|19130-19287;
      Skellefteå|75|93130-93199;
      Kalmar|73|39231-39365;
      Mölndal|72|43130-43199;
      Varberg|69|43220-43299;
      Norrtälje|67|76130-76199;
      Östersund|65|83130-83599;
      Gotland|61|62140-62199;
      Falun|60|79130-79199;
      Trollhättan|59|46130-46199`),
    digits: 5,
    step: 1,
    surnames: words(
      'Andersson, Johansson, Karlsson, Nilsson, Eriksson, Larsson, Olsson, Persson, Svensson, Gustafsson, Pettersson, Jonsson, Jansson, Hansson, Bengtsson, Jönsson, Lindberg, Jakobsson, Magnusson, Lindström, Olofsson, Lindqvist, Lindgren, Berg, Axelsson, Bergström, Lundberg, Lind, Lundgren, Lundqvist, Mattsson, Berglund, Fredriksson, Sandberg, Henriksson',
    ),
    first: words('Lars, Mikael, Anders, Johan, Erik, Per, Karl, Peter, Jan, Thomas, Anna, Eva, Maria, Karin, Kristina, Lena, Sara, Ingrid, Emma, Elsa, Alice, Maja, Astrid, Wilma, Oscar, William, Hugo, Lucas, Liam, Elias'),
    streets: words('Storgatan, Drottninggatan, Kungsgatan, Skolgatan, Kyrkogatan, Järnvägsgatan, Parkvägen, Björkvägen, Ringvägen, Södra vägen, Norra vägen, Bergsgatan, Stationsgatan, Tallvägen, Ekvägen, Industrivägen, Torggatan, Hamngatan'),
  },
  {
    id: 'md',
    name: 'Moldova',
    native: 'Moldova',
    cities: towns(`
      Chișinău|567|2001-2075;
      Tiraspol|133|3300-3305;
      Bălți|91|3100-3121;
      Bender|91|3200-3204;
      Rîbnița|47|5500-5502;
      Ungheni|26|3600-3602;
      Dubăsari|25|4500-4502;
      Cahul|22|3900-3909;
      Orhei|22|3500-3506;
      Soroca|21|3000-3006;
      Comrat|19|3800-3807;
      Ialoveni|14.7|6800-6802;
      Strășeni|14.5|3700-3705;
      Ceadîr-Lunga|14.3|6100-6102;
      Slobozia|14|5700-5701;
      Căușeni|13.5|4300-4302;
      Drochia|12.9|5200-5202;
      Edineț|12.4|4600-4602;
      Fălești|11.9|5900-5902;
      Hîncești|11.4|3400-3402;
      Vulcănești|10.9|5300-5301;
      Florești|10.9|5000-5002;
      Taraclia|10|7400-7401;
      Sîngerei|10|6200-6202;
      Călărași|9.5|4400-4402;
      Rezina|9.4|5400-5401;
      Nisporeni|9.1|6400-6402;
      Anenii Noi|8.9|6500-6501;
      Cimișlia|8.8|4100-4102;
      Rîșcani|8.6|5600-5601;
      Glodeni|7.3|4900-4901;
      Leova|6.4|6300-6301;
      Basarabeasca|6.3|7600-7601;
      Dondușeni|6|5100-5101;
      Briceni|5.8|4700-4701;
      Criuleni|5.8|4800-4801;
      Telenești|5.7|5800-5801;
      Ocnița|5.5|7100-7101;
      Ștefan Vodă|5.4|4200-4201;
      Șoldănești|5|7200-7201`),
    digits: 4,
    step: 1,
    surnames: words(
      'Rusu, Ceban, Ciobanu, Țurcanu, Sârbu, Lungu, Cojocaru, Munteanu, Popa, Rotari, Guțu, Melnic, Bivol, Roșca, Cebotari, Grosu, Cazac, Lupu, Moraru, Botnari, Postolachi, Bodrug, Moldovan, Railean, Babin, Cucu, Croitoru, Chiriac, Popescu, Vasilache',
    ),
    first: words('Ion, Vasile, Gheorghe, Nicolae, Andrei, Mihai, Alexandru, Sergiu, Victor, Dumitru, Igor, Vladimir, Maria, Elena, Ana, Natalia, Tatiana, Svetlana, Olga, Cristina, Ecaterina, Valentina, Daniel, David, Sofia, Alexandra, Irina, Nicoleta, Dorin, Lilia'),
    streets: words('str. Ștefan cel Mare, str. Mihai Eminescu, str. Alexandru cel Bun, str. Independenței, str. Pușkin, str. Păcii, str. Libertății, str. Mitropolit Varlaam, str. Ion Creangă, str. Vasile Alecsandri, str. Decebal, str. Grigore Vieru, str. 31 August 1989, bd. Dacia, str. Bucuriei, str. Tighina'),
  },
  {
    id: 'in',
    name: 'India',
    native: 'भारत / India',
    cities: towns(`
      Mumbai|12442|400001-400104;
      Delhi|11035|110001-110096;
      Bengaluru|8444|560001-560103;
      Hyderabad|6993|500001-500098;
      Chennai|6748|600001-600119;
      Ahmedabad|5578|380001-380061;
      Kolkata|4497|700001-700160;
      Surat|4468|395001-395023;
      Pune|3124|411001-411062;
      Jaipur|3046|302001-302040;
      Lucknow|2817|226001-226031;
      Kanpur|2765|208001-208027;
      Nagpur|2406|440001-440037;
      Indore|1964|452001-452020;
      Thane|1841|400601-400615;
      Bhopal|1798|462001-462046;
      Visakhapatnam|1728|530001-530053;
      Patna|1684|800001-800030;
      Vadodara|1671|390001-390025;
      Ghaziabad|1649|201001-201017;
      Ludhiana|1619|141001-141017;
      Agra|1586|282001-282010;
      Nashik|1486|422001-422013;
      Faridabad|1414|121001-121013;
      Meerut|1305|250001-250006;
      Rajkot|1287|360001-360007;
      Varanasi|1198|221001-221011;
      Srinagar|1181|190001-190025;
      Aurangabad|1175|431001-431010;
      Dhanbad|1162|826001-826015;
      Amritsar|1132|143001-143008;
      Navi Mumbai|1121|400701-400710;
      Prayagraj|1113|211001-211019;
      Howrah|1077|711101-711114;
      Ranchi|1073|834001-834012;
      Jabalpur|1056|482001-482011;
      Gwalior|1054|474001-474012;
      Coimbatore|1051|641001-641050;
      Vijayawada|1034|520001-520015;
      Jodhpur|1034|342001-342015`),
    digits: 6,
    step: 1,
    surnames: words(
      'Sharma, Singh, Kumar, Patel, Gupta, Reddy, Rao, Das, Shah, Mehta, Iyer, Nair, Joshi, Verma, Mishra, Yadav, Chauhan, Agarwal, Banerjee, Chatterjee, Mukherjee, Pillai, Menon, Khan, Ali, Desai, Kulkarni, Jain, Bose, Naidu',
    ),
    first: words('Rahul, Amit, Rajesh, Sunil, Suresh, Deepak, Arjun, Vikram, Ravi, Sanjay, Anil, Aarav, Vivaan, Aditya, Rohan, Priya, Anjali, Pooja, Neha, Sneha, Kavita, Sunita, Lakshmi, Diya, Ananya, Isha, Meera, Divya, Farhan, Ayesha'),
    streets: words('MG Road, Station Road, Gandhi Nagar, Nehru Street, Main Road, Church Street, Park Street, Ring Road, Civil Lines, Shastri Nagar, Rajendra Nagar, Model Town, Subhash Road, Netaji Marg, Patel Nagar, Market Road, Temple Street, Sector 14'),
  },
  {
    id: 'au',
    name: 'Australia',
    native: 'Australia',
    cities: towns(`
      Melbourne|5328|3000-3207, 3750-3810|VIC;
      Sydney|5220|2000-2234, 2745-2770|NSW;
      Brisbane|2745|4000-4179, 4500-4519|QLD;
      Perth|2431|6000-6199|WA;
      Adelaide|1471|5000-5199|SA;
      Gold Coast|762|4207-4230|QLD;
      Newcastle|542|2280-2320|NSW;
      Canberra|521|2600-2620, 2900-2914|ACT;
      Sunshine Coast|425|4550-4575|QLD;
      Central Coast|354|2250-2263|NSW;
      Wollongong|322|2500-2530|NSW;
      Geelong|314|3211-3227|VIC;
      Hobart|234|7000-7055|TAS;
      Townsville|191|4810-4818|QLD;
      Cairns|164|4868-4879|QLD;
      Toowoomba|154|4350|QLD;
      Darwin|145|800-832|NT;
      Ballarat|121|3350-3357|VIC;
      Bendigo|106|3550-3556|VIC;
      Albury-Wodonga|102|2640-2641, 3689-3691|NSW;
      Launceston|93|7248-7250|TAS;
      Mackay|90|4740|QLD;
      Rockhampton|84|4700-4702|QLD;
      Bunbury|84|6230|WA;
      Bundaberg|79|4670|QLD;
      Coffs Harbour|77|2450|NSW;
      Hervey Bay|63|4655|QLD;
      Wagga Wagga|58|2650|NSW;
      Shepparton|55|3630|VIC;
      Mildura|54|3500|VIC;
      Port Macquarie|53|2444|NSW;
      Gladstone|49|4680|QLD;
      Tamworth|46|2340|NSW;
      Busselton|46|6280|WA;
      Traralgon|44|3844|VIC;
      Orange|43|2800|NSW;
      Bowral|43|2575-2576|NSW;
      Dubbo|42|2830|NSW;
      Geraldton|42|6530|WA;
      Nowra|40|2541|NSW`),
    digits: 4,
    step: 1,
    surnames: words(
      'Smith, Jones, Williams, Brown, Wilson, Taylor, Johnson, White, Martin, Anderson, Thompson, Nguyen, Thomas, Walker, Harris, Lee, Ryan, Robinson, Kelly, King, Davis, Wright, Evans, Roberts, Green, Hall, Wood, Jackson, Clarke, Patel',
    ),
    first: words('Jack, Oliver, William, Noah, Thomas, James, Lucas, Michael, David, Daniel, Matthew, Andrew, Lachlan, Charlotte, Olivia, Amelia, Isla, Mia, Ava, Grace, Chloe, Emily, Sarah, Jessica, Ruby, Zoe, Hannah, Liam, Henry, Ella'),
    streets: words('George Street, King Street, High Street, Church Street, Station Street, Main Road, Victoria Street, Queen Street, Elizabeth Street, Park Road, Railway Parade, Smith Street, Beach Road, William Street, Bridge Road, Hill Street, Pacific Highway, Albert Street'),
  },
];

/** The country a browser's languages point to (Dutch, and anything unknown, → the Netherlands). */
export function countryFromLanguages(langs: readonly string[]): CountryId {
  for (const l of langs) {
    const [lang = '', region = ''] = l.toLowerCase().split('-');
    if (region === 'be') return 'be';
    if (region === 'md') return 'md';
    if (region === 'in') return 'in';
    if (region === 'au') return 'au';
    if (region === 'fr') return 'fr';
    if (region === 'de' || region === 'at' || region === 'ch') return lang === 'fr' ? 'fr' : 'de';
    if (region === 'fi') return 'fi';
    if (region === 'se') return 'se';
    if (region === 'nl') return 'nl';
    const byLang: Record<string, CountryId> = { nl: 'nl', fr: 'fr', de: 'de', fi: 'fi', sv: 'se', ro: 'md', hi: 'in' };
    if (byLang[lang]) return byLang[lang]!;
  }
  return 'nl';
}

/** The chosen country: from the settings, else from the browser, else the Netherlands. */
function chosen(): Country {
  let id: string | undefined;
  try {
    id = (JSON.parse(globalThis.localStorage?.getItem('sortsim.settings') ?? '{}') as { country?: string }).country;
  } catch {
    /* no storage */
  }
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('country');
    if (q) id = q;
  } catch {
    /* not in a browser */
  }
  if (!id && typeof navigator !== 'undefined') id = countryFromLanguages(navigator.languages ?? [navigator.language]);
  return COUNTRIES.find((c) => c.id === id) ?? COUNTRIES[0]!;
}

/** The country the hub serves now (a live binding: it can change while the hall runs, see setCountry). */
export let COUNTRY: Country = chosen();

const countryListeners: ((now: Country, was: Country) => void)[] = [];
/** Be told when the country changes (in the order asked; the postcode tables first). */
export function onCountry(fn: (now: Country, was: Country) => void): void {
  countryListeners.push(fn);
}
/** Serve another country from now on: names, places, streets and postcodes follow (the hall stays as built). */
export function setCountry(id: CountryId): void {
  const next = COUNTRIES.find((c) => c.id === id);
  if (!next || next === COUNTRY) return;
  const was = COUNTRY;
  COUNTRY = next;
  for (const fn of countryListeners) fn(next, was);
}

/** A postcode as numbers only, with its leading zeros (for signs): "06000", "0800". */
export const pcDigits = (pc: number, c: Country = COUNTRY) => String(pc).padStart(c.digits, '0');

/** A postcode as written on an address (without the Dutch letters). */
export function pcText(pc: number, c: Country = COUNTRY): string {
  const d = pcDigits(pc, c);
  if (c.id === 'se') return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (c.id === 'md') return `MD-${d}`;
  return d;
}
