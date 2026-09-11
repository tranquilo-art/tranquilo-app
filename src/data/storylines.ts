// Tranquilo storylines: hand-curated sequences of items that tell a real
// story rather than a random cluster. Quoted keys throughout to match
// data.js's convention.
//
// Curation is manual for this v1, so each storyline carries a `tier` by
// hand: "structural" means the connection is visible directly in existing
// fields (low risk, grouping not asserting); "narrative" means a real
// historical fact not visible in the fields, which carries hallucination
// risk, so every "narrative" storyline below carries a `source_note` for
// where it was verified.
//
// Each item referenced below also needs a matching `storyline_ids` entry
// on its data.js record, which is what the feed slide checks to show the
// storyline chip.
import type { Storyline } from "../types/Storyline";

export const STORYLINES: Storyline[] = [
  {
    "id": "el-greco-evolution",
    "title": "El Greco, Across Forty Years",
    "type": "body_of_work",
    "tier": "structural",
    "cover_item_id": 436572,
    "intro_caption": "Follow El Greco across four decades and two countries -- from a young painter absorbing Venice's lessons in perspective, to Spain's most unsettling portraitist, to the visionary, proto-modern canvases that would obsess Picasso three centuries later.",
    "items": [
      {
        "id": 436572,
        "position": 1,
        "chapter_caption": "Before El Greco was \"El Greco,\" he was a young Cretan painter in Venice, still working in a mode indebted to the Venetian masters around him -- he even left one corner of this canvas unfinished, exposing the loose underdrawing beneath."
      },
      {
        "id": 436573,
        "position": 2,
        "chapter_caption": "Thirty years later, in Toledo: El Greco painting Spain's own inquisitor general, likely on official Inquisition business. The portrait's intensity was still turning heads three centuries on -- painter Mary Cassatt spotted it and pushed her collector friends the Havemeyers to buy it, a purchase that took them four hard-fought years."
      },
      {
        "id": 436576,
        "position": 3,
        "chapter_caption": "By the end of his life, El Greco had stopped painting the world as it looks and started painting it as revelation feels -- elongated bodies, unstable color, apocalyptic light. This altarpiece fragment was later studied intently by Picasso while he developed Les Demoiselles d'Avignon."
      }
    ]
  },
  {
    "id": "goya-garcini-marriage",
    "title": "A Marriage, Painted",
    "type": "patron_family",
    "tier": "narrative",
    "source_note": "Josefa de Castilla Portugal y van Asbrock married Ignacio Garcini y Queralt on January 19, 1801, in Madrid; Garcini commissioned both portraits from Goya in 1804, and the pair descended together through the Garcini family for over a century before entering the Met by the same bequest. Verified against the Met's own object/curatorial records and the Fundación Goya en Aragón.",
    "cover_item_id": 436543,
    "intro_caption": "In 1804, three years into their marriage, Colonel Ignacio Garcini commissioned Goya to paint portraits of himself and his wife Josefa -- a pendant pair, painted separately, meant to hang together.",
    "items": [
      {
        "id": 436542,
        "position": 1,
        "chapter_caption": "First, the husband: Ignacio Garcini, brigadier of engineers, painted in the uniform of his rank. The decorations on his coat were added later -- he didn't receive them until 1806, so the portrait was touched up to keep pace with his rising honors."
      },
      {
        "id": 436543,
        "position": 2,
        "chapter_caption": "Then the wife: Josefa, painted the same year in a quieter register -- loose-haired, in a simple dress, holding a small fan. The two paintings stayed together in the Garcini family for over a century before being sold in 1910 and eventually bequeathed to the Met as a pair."
      }
    ]
  },
  {
    "id": "rubens-van-dyck-workshop",
    "title": "The Master and His Best Pupil",
    "type": "teacher_student",
    "tier": "narrative",
    "source_note": "Van Dyck joined Rubens' Antwerp workshop by 1616-17 and was already being called \"my best pupil\" by Rubens himself by 1618; he struck out on his own in 1620, made a brief trip to England that winter, then departed for a formative six years in Italy in October 1621. Verified via the Metropolitan Museum's own curatorial essay \"Peter Paul Rubens and Anthony van Dyck: Paintings\" and independent biographical sources (Britannica, Wikipedia).",
    "cover_item_id": 436258,
    "intro_caption": "In 1616, a teenage Anthony van Dyck joined Peter Paul Rubens' Antwerp workshop -- by 1618 Rubens was calling him \"my best pupil.\" Four years later, van Dyck struck out on his own.",
    "items": [
      {
        "id": 437536,
        "position": 1,
        "chapter_caption": "The year van Dyck joined the workshop, Rubens was busy inventing a new genre entirely: giant hunting scenes like this one, painted with a team of assistants and sold to wealthy patrons as a cheaper, faster alternative to tapestries. Rubens insisted the wolves themselves were his own hand alone."
      },
      {
        "id": 436258,
        "position": 2,
        "chapter_caption": "Four years on, in the winter of 1620-21: a twenty-one-year-old van Dyck, no longer anyone's assistant, painting himself as an aristocrat rather than a tradesman -- no palette, no brushes in sight. Within the year he'd be gone to Italy, chasing Titian instead of Rubens."
      }
    ]
  },
  {
    "id": "madonna-and-child-across-eras",
    "title": "One Subject, Five Centuries",
    "type": "shared_subject",
    "tier": "structural",
    "cover_item_id": 435658,
    "intro_caption": "Four painters, five centuries, one subject: watch Mother and Child get reinvented -- from a Byzantine icon type transplanted to medieval Italy, through the Renaissance and the Baroque, into the powdered elegance of Enlightenment France.",
    "items": [
      {
        "id": 435658,
        "position": 1,
        "chapter_caption": "The earliest version here follows the Hodegetria type -- \"She Who Shows the Way\" -- an image formula that reached Italy from Byzantium after 1204. This is one of only two paintings that can be confidently attributed to Berlinghiero at all."
      },
      {
        "id": 435641,
        "position": 2,
        "chapter_caption": "Two and a half centuries later, Bellini opens a window behind the sacred scene: barren hills give way to a lush, distant town, a quiet visual metaphor for renewal folded into an otherwise traditional composition."
      },
      {
        "id": 436262,
        "position": 3,
        "chapter_caption": "By 1630, van Dyck -- nine years into his own post-Rubens career -- paints the scene with a warmth and rhythm he'd absorbed studying Titian and Veronese in Italy, adding Saint Catherine and her legendary mystical marriage to the gathering."
      },
      {
        "id": 435744,
        "position": 4,
        "chapter_caption": "The last stop is 1765 Paris, the same year Boucher was named director of the French Royal Academy -- Eucharistic grapes and a lamb tucked into a scene soft enough to pass for a pastoral idyll."
      }
    ]
  },
  {
    "id": "degas-modern-paris",
    "title": "A Painter's Modern Paris",
    "type": "body_of_work",
    "tier": "structural",
    "source_note": "Marie van Goethem identified as the model for The Little Fourteen-Year-Old Dancer per Met object record and Wikipedia (\"Marie van Goethem\", \"Little Dancer of Fourteen Years\").",
    "cover_item_id": 196439,
    "intro_caption": "Before he was the painter of dancers and hatmakers, Edgar Degas painted his friends. Four works, sixteen years apart, trace how a portraitist's eye turned toward the working women of Paris -- and, once, toward a fourteen-year-old ballet student who became the only sculpture he ever showed in public.",
    "items": [
      {
        "id": 436122,
        "position": 1,
        "chapter_caption": "In 1866, a young Degas painted this print collector -- traditional in subject, but already sharp-eyed about a very specific kind of Parisian: someone who spent his life looking closely at pictures."
      },
      {
        "id": 436144,
        "position": 2,
        "chapter_caption": "A year or two later, Degas turned the same scrutiny on a friend: fellow painter James Tissot, seated with the loose, confident authority of one artist sizing up another."
      },
      {
        "id": 196439,
        "position": 3,
        "chapter_caption": "By 1881, Degas was sketching Marie van Goethem, a fourteen-year-old student at the Paris Opera's ballet school, class after class. The wax-and-fabric sculpture he built from those studies -- real bodice, real ballet slippers, a wig of real hair -- was the only sculpture he ever exhibited in his lifetime, and it unsettled audiences who weren't ready to see a real, unglamorous teenager instead of an idealized dancer."
      },
      {
        "id": 436126,
        "position": 4,
        "chapter_caption": "A year later, Degas was back to pastel and back to working women -- this time a milliner's shop, hats mid-fitting, the labor of fashion caught rather than the finished performance of it."
      }
    ]
  },
  {
    "id": "vangogh-final-years",
    "title": "Arles to Saint-Rémy",
    "type": "body_of_work",
    "tier": "structural",
    "source_note": "Marie Ginoux / Café de la Gare and the Saint-Rémy asylum period per Wikipedia (\"L'Arlésienne (painting)\") and Met object record; Van Gogh's death in July 1890, months after Irises, is standard biographical record.",
    "cover_item_id": 436528,
    "intro_caption": "In November 1888, Van Gogh painted the woman who ran his local café in under an hour. Eighteen months and one breakdown later, he was still painting -- cypresses, wheat fields, irises -- from inside the asylum walls at Saint-Rémy. Three works trace the last two years of his life.",
    "items": [
      {
        "id": 436529,
        "position": 1,
        "chapter_caption": "Marie Ginoux ran the Café de la Gare in Arles, where Van Gogh lodged in 1888. When she agreed to sit, he finished this portrait in about an hour, working alongside Gauguin, who sketched her at the same sitting."
      },
      {
        "id": 436535,
        "position": 2,
        "chapter_caption": "By 1889, after the breakdown that ended his time with Gauguin in Arles, Van Gogh had committed himself to the asylum at Saint-Rémy. He kept painting the view from his window and the fields beyond it -- cypresses rendered with the same restless energy as everything else he made that year."
      },
      {
        "id": 436528,
        "position": 3,
        "chapter_caption": "Irises was painted in the last spring of Van Gogh's life, 1890. He would be dead within months -- but the brushwork here shows no slowing down."
      }
    ]
  },
  {
    "id": "rubens-workshop",
    "title": "A Master and His Workshop",
    "type": "body_of_work",
    "tier": "structural",
    "source_note": "Marie de Medici cycle / Luxembourg Palace commission and Marie's 1631 fall from power per Wikipedia (\"Marie de' Medici cycle\") and the Wallace Collection's catalogue entry for the related modello.",
    "cover_item_id": 437536,
    "intro_caption": "Peter Paul Rubens ran one of the busiest studios in Europe -- grand commissions, royal cycles, and hunting scenes all moving through the same workshop at once. Three works, spanning twenty years, show just how differently sized that output could be.",
    "items": [
      {
        "id": 437536,
        "position": 1,
        "chapter_caption": "At nearly eight feet wide, Wolf and Fox Hunt was too large for Rubens to have painted alone -- the Met credits it to \"Rubens and Workshop,\" typical of how his studio operated: Rubens set the composition, assistants filled in the rest."
      },
      {
        "id": 437534,
        "position": 2,
        "chapter_caption": "By contrast, this small oil sketch -- a modello -- was Rubens's own hand, working out a commission for Marie de Medici's Luxembourg Palace: a planned cycle celebrating the life of her late husband, King Henry IV. The sketch survives; the full-scale cycle was mostly never finished before Marie's fall from power in 1631."
      },
      {
        "id": 437526,
        "position": 3,
        "chapter_caption": "By the mid-1630s, Rubens was painting hunts again -- smaller, quieter, and, unlike the 1616 canvas, entirely his own."
      }
    ]
  },
  {
    "id": "still-life-three-centuries",
    "title": "Still Life Through Three Centuries",
    "type": "shared_subject",
    "tier": "structural",
    "cover_item_id": 435904,
    "intro_caption": "Five painters, nearly three centuries, one deceptively ordinary-sounding subject -- but \"still life\" can hold almost anything: a skull with something to say, a table laid for supper, the spoils of a hunt, a harvest of vegetables, a teapot painted an ocean away from home.",
    "items": [
      {
        "id": 435904,
        "position": 1,
        "chapter_caption": "Open with its real subject: not the skull alone, but everything gathered around it. A snuffed oil lamp, a toppled glass, an open book with its quill laid across the page -- every object here is a stand-in for something that doesn't last. This is vanitas, a genre built entirely to remind a wealthy owner that none of it, including them, sticks around."
      },
      {
        "id": 436305,
        "position": 2,
        "chapter_caption": "Painted around the same years, in the same broad tradition, but pointed the opposite way: bread, wine, a halved lemon, a plate of olives and cracked walnuts, and a small bird perched right on the loaf -- abundance, not mortality. Flegel was one of the earliest painters in Germany to make a career out of food alone."
      },
      {
        "id": 435887,
        "position": 3,
        "chapter_caption": "A century later in France, still life had a rougher edge: a dead hare draped over the ledge, a game bird beside it, a cat eyeing the hare from below. Chardin painted the spoils of a hunt as unsentimentally as he painted anything -- fur, feather, and fruit given the same careful attention."
      },
      {
        "id": 11734,
        "position": 4,
        "chapter_caption": "Jump a century again, and an ocean, for the newest genre in the sequence: the American produce painting. No hunt, no memento mori -- just cabbage, squash, corn still in its husk, and tomatoes, painted with the same close attention the Dutch gave a skull two hundred years earlier."
      },
      {
        "id": 437999,
        "position": 5,
        "chapter_caption": "The last stop is 1896, about as far from a Dutch parlor as this genre gets: a blue-and-white teapot and mangoes ripening through green to red, painted by Gauguin in Tahiti. Same genre, same basic arrangement -- vessel, cloth, fruit -- rendered in flat color and bold outline instead of the shadowed realism the other four share."
      }
    ]
  },
  {
    "id": "salvator-rosa-witchcraft",
    "title": "Scenes of Witchcraft",
    "type": "body_of_work",
    "tier": "structural",
    "source_note": "Confirmed via Cleveland Museum of Art's own object records (accession 1977.37.1–.4): commissioned as a matched set, same provenance (Niccolini family, Florence, by 1657 → Heim Gallery, London → CMA, 1977), same date (c. 1645–1649), all on view together today (Gallery 217). Published scholarship: Salerno & Kohn, 'Four Witchcraft Scenes by Salvator Rosa,' The Bulletin of the Cleveland Museum of Art 65, no. 7 (Sept 1978): 225-231; Langdon, Salvator Rosa: Paint and Performance (2022), ch. 2; Fabbri, 'Quattro Tondi con Incantesimi di Salvator Rosa,' Notizie da Palazzo Albani XXXVIII (2009). CMA held a dedicated exhibition on this exact suite, The Novel and the Bizarre: Salvator Rosa's Scenes of Witchcraft (Feb–June 2015).",
    "cover_item_id": 149108,
    "intro_caption": "In the 1640s, Salvator Rosa painted magic as a working artist's day: four small tondi, one for each phase of daylight into dark, tracing witchcraft from a dawn stabbing to a night of conjured spirits. Cleveland is one of the only places in the world where you can see all four together, exactly as Rosa meant them to be seen.",
    "items": [
      {
        "id": 149105,
        "position": 1,
        "chapter_caption": "At dawn, a young witch plunges a knife into a writhing toad while dark birds circle overhead. Rosa gives her an unusual beauty for a sorceress -- closer to Circe than to a crone -- then undercuts it: her calm expression makes the violence of the scene more unsettling, not less."
      },
      {
        "id": 149106,
        "position": 2,
        "chapter_caption": "By full daylight, the witches turn openly grotesque: hags flaying a lizard for its innards, brandishing skulls, preparing for a night at the Sabbath. Rosa gives them an owl instead of the traditional goat to ride there -- and sets the whole scene in bright, un-hiding light, which makes the horror read as comedy as much as menace."
      },
      {
        "id": 149107,
        "position": 3,
        "chapter_caption": "At dusk, a conjured skeleton holding an hourglass rises above a circle of hags at their cauldron -- a reminder, in the painting's own symbolism, that time runs out for everyone. Rosa was a poet as well as a painter, and wrote his own verses about witches brewing love potions from 'ground powders, mystic gems, snakes and owls'; this panel paints what those poems described."
      },
      {
        "id": 149108,
        "position": 4,
        "chapter_caption": "In full dark, a wizard conjures apparitions for a group of uneasy travelers in the woods -- necromancy, historically a male sorcerer's domain, unlike the female witchcraft of the earlier panels. Rosa's magician stands like an old-master prophet, and probably stands in for something closer to home: the artist himself, shaping a strange world out of intellect, originality, and paint."
      }
    ]
  },
  {
    "id": "vangogh-saint-remy-auvers",
    "title": "Saint-Rémy to Auvers",
    "type": "body_of_work",
    "tier": "structural",
    "source_note": "Chronology, letter quotation, conservation finding (Cleveland's Large Plane Trees confirmed as the first version, with a repetition at the Phillips Collection), and the Adeline Ravoux anecdote all per Cleveland Museum of Art's own object records (accession 1947.209, 1958.31, 1958.32) -- no claim here needs outside grounding beyond what Cleveland's own catalogue already documents and cites.",
    "cover_item_id": 135299,
    "intro_caption": "By spring 1889, Van Gogh had committed himself to the asylum at Saint-Rémy, painting the grounds and the view from his window under his doctor's supervision. A year later, in his last spring alive, he was boarding at a Paris-area inn, painting the innkeeper's thirteen-year-old daughter. Three works trace those last fifteen months.",
    "items": [
      {
        "id": 135310,
        "position": 1,
        "chapter_caption": "Interned at Saint-Rémy, van Gogh was at first restricted to painting in his room -- but was soon allowed back outdoors. Two Poplars in the Alpilles shows what that permission gave him: trees twisting against a darkening sky, painted with the same charged, unslowed brushwork that defined his final years."
      },
      {
        "id": 125249,
        "position": 2,
        "chapter_caption": "Van Gogh's doctor believed painting eased his symptoms and let him work outside under supervision. He described this exact scene in a letter to his brother Theo: 'a view of the village, where they were at work under some enormous plane trees — repairing the pavements... heaps of sand, stones, and the gigantic trunks.' Conservation research later found this Cleveland canvas to be the first version of a composition he then repeated -- the Phillips Collection in Washington holds the second."
      },
      {
        "id": 135299,
        "position": 3,
        "chapter_caption": "In May 1890, in the last months of his life, van Gogh left the asylum and took a room at an inn in Auvers-sur-Oise, run by the Ravoux family. He painted their thirteen-year-old daughter Adeline, who wasn't happy with the result -- she didn't think it looked like her. Decades later, a photograph of Adeline in her seventies surfaced, and the resemblance turned out to be exact."
      }
    ]
  },
  {
    "id": "redon-apocalypse",
    "title": "Redon Draws the End of the World",
    "type": "body_of_work",
    "tier": "narrative",
    "source_note": "ORDERING: Cleveland's accession sequence (1926.140.2-.13) runs in scripture order except that Rev 1:16 sits eighth and 20:2/20:10 are swapped. Cleveland does not publish the portfolio's own plate order, so rather than infer it from accession numbers these are sequenced by the Book of Revelation itself -- verifiable, since every title is a verbatim King James quotation, and it is the order the set narrates. SOURCES: Published by Ambroise Vollard, Paris, 1899, printed by Blanchard, in an edition of 100; twelve lithographs plus a lithographed cover. Publisher, printer and plate count confirmed against Cleveland Museum of Art's own record for the bound portfolio (accession 1926.140), which states 'Twelve lithographs on wove paper', names Blanchard as printer and Vollard as publisher, and notes the series 'relates to the Book of Revelation' and that 'these prints directly illustrate 12 individual passages'; edition size of 100 via Galerie Kornfeld and dealer catalogue records. That this was the last of Redon's eleven lithographic albums, and that he produced no more noirs after 1900 -- turning to color, oils and pastel, with flowers a favoured late subject -- per the National Galleries of Scotland and Van Gogh Museum artist biographies. Each plate's verse was matched programmatically against the King James text of Revelation rather than assigned from memory; all twelve matched on runs of 5 to 26 consecutive opening words. The cover plate is deliberately excluded -- it is a typographic title page, not an image.",
    "cover_item_id": 108401,
    "intro_caption": "The Book of Revelation is a letter written by a man in exile, describing a vision of the end of the world in images so strange that people have been arguing about what they mean for two thousand years. In 1899 the dealer Ambroise Vollard paid Odilon Redon to illustrate it and printed 100 copies. Twelve plates, twelve passages -- and Redon, who had worked almost entirely in black for thirty years, never made another album this way again.",
    "items": [
      {
        "id": 108403,
        "position": 1,
        "chapter_caption": "It starts with a letter. John is in exile on Patmos when a figure appears holding seven stars, a sword coming out of his mouth, and tells him to write to seven churches. The stars are those churches -- the book explains its own symbol a few lines later, which it almost never does again. Everything after this is what he was shown."
      },
      {
        "id": 108396,
        "position": 2,
        "chapter_caption": "In heaven, a scroll sealed seven times. An angel asks who is worthy to open it, and the answer is nobody -- John says he wept much. Then one of the elders tells him to stop crying, because someone has been found after all. The seals are about to come off."
      },
      {
        "id": 108397,
        "position": 3,
        "chapter_caption": "Four seals open and four riders go out. This is the fourth, and the only one the text bothers to name: Death, with Hell following along behind him. Between them they are given power over a quarter of the earth."
      },
      {
        "id": 108399,
        "position": 4,
        "chapter_caption": "The seventh seal brings silence, then seven angels with seven trumpets. First an angel offers incense together with the prayers of the saints and the smoke rises. Then he fills that same censer with fire from the altar and throws it at the earth. That is the signal for the trumpets to start."
      },
      {
        "id": 108400,
        "position": 5,
        "chapter_caption": "The first two trumpets hit the land and the sea. The third drops a burning star into the rivers, and the text gives it a name -- Wormwood, after a famously bitter desert plant -- as a third of the world's fresh water turns bitter enough to kill."
      },
      {
        "id": 108401,
        "position": 6,
        "chapter_caption": "A break in the disasters for the strangest image in the book: a woman wearing the sun, standing on the moon, crowned with twelve stars, with a red dragon waiting below to eat her child the moment it is born. Who she is has never been settled -- Israel, the Church, Eve, Mary, or deliberately all of them at once."
      },
      {
        "id": 108402,
        "position": 7,
        "chapter_caption": "Then the harvest. A figure on a cloud swings a sickle over the ripe earth, and a second angel comes out of the temple carrying another one -- the sickle in this plate -- and is told to gather the grapes instead. The grapes go into a winepress."
      },
      {
        "id": 108404,
        "position": 8,
        "chapter_caption": "An angel comes down from heaven carrying exactly two things: the key to the bottomless pit, and a great chain. For once Revelation is completely unambiguous about what is coming next."
      },
      {
        "id": 108406,
        "position": 9,
        "chapter_caption": "He takes the dragon -- the text stacks up serpent, Devil and Satan in a single breath -- and binds it for a thousand years. Those thousand years are one of the most argued-over spans in the Bible, read as a literal future reign, as the whole stretch of history we are already living in, or as a golden age still ahead."
      },
      {
        "id": 108405,
        "position": 10,
        "chapter_caption": "The thousand years end, there is one final war, and the devil is thrown into a lake of fire where the beast and the false prophet already are. That is the last the book has to say about him."
      },
      {
        "id": 108407,
        "position": 11,
        "chapter_caption": "And then a city comes down out of the sky. A new heaven and a new earth, and God moving in to live with people: no more death, no more sorrow or crying, no more pain. Note the direction -- heaven arrives here, rather than people leaving for it."
      },
      {
        "id": 108408,
        "position": 12,
        "chapter_caption": "It ends with John. Overwhelmed by what he has been shown, he falls at the angel's feet to worship him -- and is immediately corrected: I am a fellow servant, worship God. It is the second time he has tried it. The last human moment in Revelation is the narrator getting it wrong."
      }
    ]
  },
  {
    "id": "cubism-before-and-after",
    "title": "Breaking the Picture Apart",
    "type": "movement_arc",
    "tier": "narrative",
    "source_note": "Cubism traced from its precursor to its afterlife across eight Cleveland Museum of Art works. Cezanne's role as the movement's acknowledged ancestor, Picasso's 'father of us all', and his reduction of form to planes and geometric solids per Artlex; Stieglitz's The Steerage taken June 1907, withheld until its 1911 Camera Work publication alongside a Picasso drawing, with the Picasso praise attributable only to Stieglitz's own retelling, per Wikipedia and TIME; Wadsworth's Vorticism, his woodcuts in BLAST (summer 1914) and his wartime dazzle-camouflage work per the V&A and Liverpool Biennial; Duchamp-Villon carving the Rooster plaster on WWI service for a theatre near the front lines, his death from typhoid in October 1918 and the 1919 memorial casts per Britannica and The Art Story; Marcoussis born Ludwik Markus in Lodz and renamed at Apollinaire's suggestion after a village near Paris, cubist from c.1911, per Wikipedia and the Peggy Guggenheim Collection; Gris's 1920s lithographs turning to pure line and a cooler classicism per Crystal Cubism and Maitres des Arts Graphiques; Mondrian's 1911 move to Paris prompted by Braque and Picasso, his judgement that cubism was 'a means, not an end', and De Stijl's founding in 1917 per Britannica and The Art Story. All verified via web search; no third-party host was fetched.",
    "cover_item_id": 164630,
    "intro_caption": "Cubism didn't come from nowhere, and it didn't stop once it was finished. Eight works, in order: the painter who taught everyone to see in planes, the movement at full tilt, the war that scattered it, and the artist who pushed its logic further than its inventors ever wanted to go.",
    "items": [
      {
        "id": 115405,
        "position": 1,
        "chapter_caption": "Start seventeen years early. Cezanne built this hillside out of patches -- each one a small plane of colour shifting warm to cool -- rather than drawing the scene and filling it in. Picasso later called him \"the father of us all,\" and this is why: once you see a landscape as stacked planes, you are one step away from taking it apart."
      },
      {
        "id": 325449,
        "position": 2,
        "chapter_caption": "Taken on a ship crossing the Atlantic in 1907, with a gangway splitting the frame into two stacked worlds. Stieglitz held it back until 1911, then published it in Camera Work in the same issue as a Picasso drawing. He loved retelling how Picasso admired it -- that story comes from Stieglitz himself, so hold it loosely, but the picture really does behave like a collage."
      },
      {
        "id": 153749,
        "position": 3,
        "chapter_caption": "Cubism crossed the Channel and got louder. Wadsworth was a Vorticist -- the British answer, launched in 1914 with a magazine called BLAST that carried his woodcuts -- and cut this one all hard edges and machine energy. Then the war came, and he spent it painting \"dazzle\" onto Allied ships: jagged geometry meant not to hide a vessel but to leave a U-boat guessing which way it was pointed."
      },
      {
        "id": 146806,
        "position": 4,
        "chapter_caption": "Marcel Duchamp's older brother, sculpting at the front. He carved the original plaster on WWI service, intended for the entrance of a temporary theatre near the front lines -- a rooster and a rising sun, symbols any French soldier would read as victory. He caught typhoid at Champagne and died in 1918. This bronze is one of the casts made the following year, as a memorial."
      },
      {
        "id": 160771,
        "position": 5,
        "chapter_caption": "He was born Ludwik Markus in Lodz and studied law before art. Once he reached Paris the poet Apollinaire suggested he take the name of a village outside the city -- so, Marcoussis. He had been cubist since about 1911, alongside Picasso, Braque and Gris. By 1920 the style had stopped being an argument and become a language he could simply work in: a bar, its glasses and bottles, folded flat into overlapping plates."
      },
      {
        "id": 142692,
        "position": 6,
        "chapter_caption": "Gris was one of cubism's own, and by the 1920s he was easing back out of it. His prints from these years run on pure line -- elegant contours, repeated rhythms, a turn toward something cooler and more classical. This one is a lithograph in a single red ink. The instinct to break a face into planes is still there, but it is being handled gently."
      },
      {
        "id": 164630,
        "position": 7,
        "chapter_caption": "Marcoussis again, three years on and in oil. A cafe at night, assembled from tilted planes that never quite agree on where you are standing. By now nobody was shocked by this. Cubism had become something a painter could be fluent in, and fluency looks like this -- relaxed, a little witty, entirely sure of itself."
      },
      {
        "id": 143278,
        "position": 8,
        "chapter_caption": "Mondrian moved to Paris in 1911 precisely because he had seen Braque and Picasso and wanted in. Then he decided cubism had lost its nerve -- still too attached to real things, a means rather than an end. So he kept stripping: no subject, no diagonal, no colour but red, yellow and blue and the black lines holding them apart. This is 1927, and it is where cubism's logic lands when you refuse to stop."
      }
    ]
  },
  {
    "id": "why-they-went",
    "title": "Why They Went",
    "type": "shared_subject",
    "tier": "narrative",
    "source_note": "Three photographic expeditions to Egypt and the Near East within eight years, grouped by the reason each was undertaken rather than by place. Du Camp travelled 1849-51 under a French government commission with Gustave Flaubert, sailing from Marseille 4 November 1849, reaching the Nile Delta on the 15th, going up the Nile to the second cataract and Abu Simbel in March 1850 before descending, and leaving Egypt in July 1850; he made over 200 calotypes, 125 of which were printed by Blanquart-Evrard for his 1852 album, the first French book illustrated with photographs -- per the Centre Flaubert (Universite de Rouen) and the BnF. Salzmann went to Jerusalem in 1854 inspired by the archaeologist Felix de Saulcy and entered a scientific debate over the age of the city's walls, making about 200 paper negatives of 68 sites in four months and titling plates so they could be used as archaeological evidence; his album appeared from 1856 in 58 instalments -- per Hyperallergic's account of the Metropolitan's holdings. Frith made three journeys 1856-60 working wet collodion on glass from a portable wicker darkroom; his stereo views were sold through Negretti and Zambra, and F. Frith and Co., founded 1858, became the largest photographic printing business in England -- per The Past and Wikipedia. A fourth source, the present-day francisfrith.com, was removed during review: it blocked the reviewer after repeated visits, and being the company Frith founded it is promotional about its own founder. Dropping it corrected two claims. All verified via web search; no third-party host was fetched.",
    "cover_item_id": 260973,
    "intro_caption": "Photography was barely ten years old when three men carried cameras to the oldest places they could think of. They went within eight years of each other, to much the same ruins, for completely different reasons: one was sent by his government, one was trying to win an argument, and one was in business. What a photograph of a faraway place is FOR was still an open question, and between them they answered it.",
    "items": [
      {
        "id": 287073,
        "position": 1,
        "chapter_caption": "Cairo, the winter of 1849. Maxime Du Camp had a government commission and a travelling companion, his friend Gustave Flaubert, who was not yet a novelist anyone had heard of. The camera worked on paper negatives and the chemicals travelled in glass jugs."
      },
      {
        "id": 263235,
        "position": 2,
        "chapter_caption": "Karnak, 1850. A granite sanctuary and a hall of columns too large to fit in one frame -- so he photographed it anyway, and the limits of the equipment became part of the picture. His prints were made by Blanquart-Evrard, whose workshop had just solved how to produce photographs in quantity rather than one sheet at a time."
      },
      {
        "id": 287159,
        "position": 3,
        "chapter_caption": "17 April 1850, and we know the day exactly. By now the pair had sailed as far as the second cataract, turned around, and were drifting back down the Nile stopping where they liked. Of some two hundred negatives, 125 became the first French book ever illustrated with photographs."
      },
      {
        "id": 287053,
        "position": 4,
        "chapter_caption": "Jerusalem, 1854, and a completely different reason to be holding a camera. Auguste Salzmann had come to settle an argument: the archaeologist Felix de Saulcy had made claims about the age of the city's monuments that other scholars flatly rejected."
      },
      {
        "id": 287054,
        "position": 5,
        "chapter_caption": "The same gate again -- this time nothing but its inscription. That is not a view of a place, it is an exhibit. Salzmann photographed each site from several distances and titled the plates so nobody could mistake which argument they belonged to."
      },
      {
        "id": 286948,
        "position": 6,
        "chapter_caption": "Two hundred paper negatives in four months, across sixty-eight sites, sorted by religion. Photographs this large and this expensive reached the public the only way they could: his album went out from 1856 in fifty-eight instalments, three plates at a time."
      },
      {
        "id": 260973,
        "position": 7,
        "chapter_caption": "Then Francis Frith, who went to sell. He made three journeys between 1856 and 1860 with a wicker darkroom he dragged into whatever shade he could find -- wet collodion plates had to be coated, exposed and developed before they dried, which in that heat meant minutes."
      },
      {
        "id": 260957,
        "position": 8,
        "chapter_caption": "His negatives were glass, not paper: sharper, and printable again and again. That is the quiet turning point. Frith's stereo views sold through a London optical firm, and the printing business he set up in 1858 became the largest in England."
      },
      {
        "id": 260971,
        "position": 9,
        "chapter_caption": "Taken about 1857 and printed in the 1870s -- the same negative still earning twenty years on. All three men ended up publishing in instalments, by subscription, whatever had sent them out there. The state mission, the argument and the shop all arrived at the same business model."
      }
    ]
  },
  {
    "id": "castiglione-pierson",
    "title": "The Countess Directs",
    "type": "body_of_work",
    "tier": "structural",
    "cover_item_id": 261370,
    "intro_caption": "For forty years, one photographer and one sitter made the same picture over and over, and never quite the same way twice. She chose the poses, the costumes and the roles; his studio printed them, and then painted over the top in watercolour until some of them barely read as photographs at all.",
    "items": [
      {
        "id": 261312,
        "position": 1,
        "chapter_caption": "The Countess arrived in Paris in 1856 as a diplomatic asset and became, almost immediately, its most photographed woman. This is her in character, the title borrowing the name of a celebrated tragic actress of the day -- a hint of how she approached the camera from the start."
      },
      {
        "id": 261287,
        "position": 2,
        "chapter_caption": "A salted paper print, the older and softer of the two processes in this sequence, with colour brushed on afterwards by hand. The studio was among the first to make retouching in watercolour and oil part of the offering rather than a repair."
      },
      {
        "id": 261290,
        "position": 3,
        "chapter_caption": "\"La Frayeur\" -- fright. The titles belong to a vocabulary of poses she returned to and refined, closer to a repertoire than a sitting."
      },
      {
        "id": 261268,
        "position": 4,
        "chapter_caption": "Left as it came off the paper, so you can see the register the paint departs from: the flatness, the grey scale, the ordinary studio light."
      },
      {
        "id": 261546,
        "position": 5,
        "chapter_caption": "Judith, the biblical widow who saves her city by charming an enemy general and beheading him. A pointed role for a woman whose reputation rested on access to powerful men."
      },
      {
        "id": 261370,
        "position": 6,
        "chapter_caption": "The same role, this time painted over. Compare it with the print before this one: the colour is not correcting anything, it is deciding where you look."
      },
      {
        "id": 261353,
        "position": 7,
        "chapter_caption": "Her dogs, on waxed paper with colour applied over the top -- the same treatment given to the portraits. The subject changes; the level of care does not."
      },
      {
        "id": 286787,
        "position": 8,
        "chapter_caption": "The method left visible. Sittings like these were worked and reworked over years, which is why so many of the images exist in near-identical variants."
      },
      {
        "id": 288112,
        "position": 9,
        "chapter_caption": "Thirty years on, from a late series made when she was in her fifties. Same photographer, same collaboration, still going -- the longest working relationship in nineteenth-century portrait photography."
      }
    ]
  },
  {
    "id": "chess-two-branches",
    "title": "Four Divisions",
    "type": "shared_subject",
    "tier": "structural",
    "cover_item_id": 436884,
    "intro_caption": "A game invented in India before the 7th century travelled west into Europe and east into China, and split into two games that no longer share a board. Follow it across four hundred years of pictures -- as a courtship device, as a lacquered object, and finally as something a camera could catch people actually doing.",
    "items": [
      {
        "id": 436884,
        "position": 1,
        "chapter_caption": "Painted on the front of a marriage chest, which tells you what the game meant here: in Renaissance storytelling a chess match between a man and a woman is almost never about chess. She is losing, and that is the point of the picture."
      },
      {
        "id": "File:Chinese chess board painted with flowers of the four seasons.jpg",
        "position": 2,
        "chapter_caption": "The other branch. Chess and xiangqi are generally traced to the same Indian ancestor, carried east along the Silk Road, but they diverged so far that the boards no longer match -- xiangqi is played on the lines rather than the squares, and a river runs across the middle."
      },
      {
        "id": 260988,
        "position": 3,
        "chapter_caption": "Around 1845, one of the earliest photographs of anyone playing anything. The long exposure explains the pose: chess was a convenient subject for early photography precisely because players hold still."
      },
      {
        "id": 267247,
        "position": 4,
        "chapter_caption": "An ambrotype from the 1850s -- a positive image on glass, cheaper than a daguerreotype and briefly everywhere. Nobody recorded who these players were."
      },
      {
        "id": 263123,
        "position": 5,
        "chapter_caption": "Damascus, 1888. The western branch of the game reached Europe through the Islamic world centuries earlier; this photograph catches it being played along the route it travelled, by people to whom it was simply the local game."
      }
    ]
  }
];

// Frozen fixture, not the live source -- storylines moved into Postgres
// (sql/019_storylines.sql/020_storylines_seed.sql); lib/storylines.ts
// queries it directly for the live shapes. Kept as the original
// hand-curated content and matched by path in scripts/select_e2e_specs.mts
// to trigger the storyline e2e group -- nothing imports it at runtime.
