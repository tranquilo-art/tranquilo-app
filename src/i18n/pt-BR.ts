// Brazilian Portuguese. Draft in the locale registry until a native-speaker
// review has been done, so it's only shown to someone who explicitly
// chooses it. Any key left out here falls back to English per key.
//
// Labels use Portuguese sentence case ("Pinturas e retratos"), not the
// English title case of the source strings.
import type { Dictionary } from "./en.ts";

export const ptBR: Dictionary = {
  "upsell.body":
    "Salvo temporariamente neste navegador. Coleções permanentes e organização fazem parte do Tranquilo Curator, que ainda está tomando forma.",
  "upsell.cta": "Entrar na lista de espera",
  "upsell.dismiss": "Fechar",

  "feed.scrollHint": "role para explorar",

  "intro.heading": "Um jeito mais calmo de navegar.",
  // Portuguese treats 0 and 1 as singular ("0 acervo"), so .one covers both.
  "intro.tagline.one":
    "Navegue com calma por {works} obras em domínio público de {count} acervo.",
  "intro.tagline.other":
    "Navegue com calma por {works} obras em domínio público de {count} acervos.",
  "intro.mission.title": "Missão",
  "intro.mission.body": "Código aberto e sem anúncios.",
  "intro.mission.cta": "Participe",
  "intro.connect.title": "Conecte-se",
  "intro.connect.body": "Arte selecionada todo mês.",
  "intro.connect.cta": "Inscreva-se",
  "intro.support.title": "Apoie",
  "intro.support.body": "Mantido pela comunidade.",
  "intro.support.cta": "Doe",

  "collection.empty.eyebrow": "Minha coleção",
  "collection.empty.title": "Nada salvo\nainda.",
  "collection.empty.body": "Toque no marcador de qualquer obra para começar.",

  // AI disclosure: draft awaiting approval (see en.ts) -- not shown yet.
  "ai.disclosure.text":
    "Redigido com ajuda de IA; editado e revisado por um indivíduo.",
  "ai.disclosure.errorPrompt": "Encontrou um erro?",
  "ai.disclosure.badgeLabel": "Como este texto foi escrito",

  "common.untitled": "Sem título",

  "slide.nudity.label": "Esta imagem pode conter nudez. Toque para ver.",
  "slide.nudity.line1": "Pode conter nudez",
  "slide.nudity.line2": "Toque para ver",
  "slide.imageError":
    "Não foi possível carregar a imagem — toque para tentar de novo",
  "slide.storylineChip": "Narrativa · {position}",
  "slide.position": "{index} de {total}",
  "slide.setPosition": "{index} de {total} no conjunto",
  "slide.share": "Copiar link para compartilhar",
  "slide.collect.add": "Adicionar à coleção",
  "slide.collect.remove": "Remover da coleção",

  "detail.close": "Fechar",
  "detail.shelfPrev": "Anterior nesta prateleira",
  "detail.shelfNext": "Próxima nesta prateleira",
  "detail.source": "Fonte",
  "detail.sourceHost": "Fonte: {host}",
  "detail.sources": "Fontes",
  "detail.bookSource": "Livro: {title}",
  "detail.twist": "A reviravolta",
  "detail.cast.title": "Conheça os personagens",
  "detail.cast.possibly": "Possivelmente {name}",
  "detail.cast.noDetail": "Ainda sem detalhes verificados.",
  "detail.fact.didYouKnow": "Você sabia?",
  "detail.fact.basic": "Informações básicas",
  "detail.meta.artist": "Artista",
  "detail.meta.created": "Criado em",
  "detail.meta.material": "Material",
  "detail.meta.artistOrigin": "Origem do(a) artista",
  "detail.meta.objectOrigin": "Origem do objeto",
  "detail.meta.origin": "Origem",
  "detail.meta.culture": "Cultura",
  "detail.meta.photographDate": "Data da fotografia",
  "detail.meta.photographer": "Fotografia por",
  "detail.meta.provenance": "Procedência",
  "detail.meta.tagged": "Marcadores",
  "detail.meta.license": "Licença",
  "detail.sourceLink.on": "Ver em {institution}",
  "detail.sourceLink.at": "Ver em {institution}",
  "detail.cite.button": "Citar esta obra",
  "detail.cite.copy": "Copiar",
  "detail.cite.copied": "Copiado",
  "detail.cite.failed": "Não foi possível copiar",
  "detail.print.button": "Comprar impressão",
  "detail.print.soon": "A compra abre em breve.",
  "detail.print.shipTo": "Enviar para",
  "detail.print.priceLoading": "Buscando preço…",
  "detail.print.priceUnavailable": "Preço indisponível",
  "detail.print.notAvailable": "Indisponível em {country}",
  "detail.print.deliveryIncluded": "inclui cerca de {price} de entrega",
  "detail.print.deliveryDays": "{min}–{max} dias",
  "detail.print.approximate": "Os preços de entrega são aproximados.",
  "detail.print.importTax":
    "O comprador é responsável pelos impostos de importação no Brasil.",
  "detail.print.showMockup": "Ver a prévia: {product}",
  "detail.print.mockupNote":
    "Uma prévia. As cores e bordas impressas podem variar um pouco.",
  "print.product.mini_print": "Mini impressão",
  "print.product.poster": "Pôster",
  "print.product.framed": "Pôster emoldurado",
  "print.product.tote": "Ecobag",
  "print.product.mug": "Caneca",
  "print.size.mini_print": "13 × 18 cm",
  "print.size.poster": "40 × 50 cm",
  "print.size.framed": "40 × 50 cm",
  "print.size.tote": "Algodão natural",
  "print.size.mug": "325 ml",
  "detail.report.button": "Relatar um problema",
  "detail.report.image": "Há um problema com a imagem",
  "detail.report.content": "Há um problema com o conteúdo",
  "detail.report.technical": "Estou com um problema técnico (link quebrado)",
  "detail.report.more": "Conte mais",
  "detail.report.commentPlaceholder": "Mais alguma coisa? (opcional)",
  "detail.report.send": "Enviar",
  "detail.report.thanks":
    "Agradecemos! Seu comentário foi enviado e vamos dar uma olhada.",

  "search.placeholder": "Busque artista, título, categoria, época…",
  "search.submit": "Buscar",
  "search.close": "Fechar a busca",
  "search.recent": "Buscas recentes",
  "search.browseBy": "Explore por",
  "search.related": "Mostrando obras relacionadas a “{concept}”",
  "search.results.one": "{count} resultado para “{query}”",
  "search.results.other": "{count} resultados para “{query}”",
  "search.noResults": "Nenhum resultado para “{query}”.",
  "search.didYouMean":
    "Nenhum resultado para “{query}”. Você quis dizer {suggestion}?",

  "filter.moreBy": "Mais por {artist}",
  "filter.collection": "{title} ({count})",
  "collection.toast.empty": "Nada salvo ainda",

  "share.copied": "Link copiado",
  "share.failed": "Não foi possível copiar o link",

  "error.heading": "Estamos com um problema agora, mas voltaremos em breve.",
  "error.retry": "Tentar de novo",
  "error.home": "Voltar para Tranquilo",

  "support.strip.line":
    "Tranquilo é mantido por apoio direto, não por anúncios.",
  "support.strip.unavailable":
    "As doações estão indisponíveis por um momento. Agradecemos a sua boa vontade — tente de novo em breve.",
  "support.strip.soon": "As doações abrem em breve.",
  "support.strip.donate": "Doar",
  "support.dialog.close": "Fechar",
  "support.dialog.title": "Apoie Tranquilo",
  "support.dialog.body":
    "Cada contribuição vai para a hospedagem e para o custo silencioso de manter tudo funcionando.",
  "support.dialog.once": "Doação única",
  "support.dialog.monthly": "Doação mensal",
  "support.dialog.perMonth": "por mês",
  "support.dialog.note":
    "O pagamento é feito por Stripe — Tranquilo nunca vê os dados do seu cartão. Os valores aparecem na sua moeda no momento do pagamento.",
  "support.once.note": "Escolha o valor",

  "support.patreon.body":
    "Prefere uma assinatura? Apoie no Patreon e acompanhe o crescimento do Tranquilo.",
  "support.patreon.join": "Apoiar no Patreon",
  "support.patreon.soon": "O Patreon abre em breve.",

  "shelves.home": "Tranquilo, voltar à página inicial",
  "shelves.title": "Descobrir",
  "shelves.close": "Fechar Descobrir",
  "shelves.storylines.title": "Narrativas",
  "shelves.storylines.subtitle": "Histórias selecionadas por trás da arte",
  "shelves.moods.title": "Prateleiras, curadas à mão",
  "shelves.moods.subtitle": "Escolha um clima e aproveite",
  "shelf.close": "Fechar a prateleira",
  "shelf.share": "Copiar link desta prateleira",
  "shelf.works.one": "{count} obra",
  "shelf.works.other": "{count} obras",

  "storyline.close": "Fechar a narrativa",
  "storyline.prev": "Página anterior",
  "storyline.next": "Próxima página",
  "storyline.hint.arrows": "Use as setas para começar →",
  "storyline.hint.swipe": "Deslize para começar →",
  "storyline.share": "Copiar link desta narrativa",
  "storyline.chapterOf": "Capítulo {index} de {total}",
  "storyline.goToChapter": "Ir para o capítulo {index}",

  "setOfWorks.details": "Ver detalhes",

  "export.title": "Seu CSV está sendo baixado",
  "export.body":
    "Sincronizar entre dispositivos, organizar listas e compartilhar fazem parte do Tranquilo Curator, que ainda está tomando forma.",

  "lightbox.loading": "Carregando em resolução máxima…",
  "lightbox.sourceRecord": "Registro original: {institution}",
  "lightbox.fullResolution": "Resolução máxima: {institution}",

  "nav.home": "Início",
  "nav.about": "Sobre",
  "nav.submit": "Enviar acervo",
  "nav.getInvolved": "Participe",
  "nav.support": "Nos apoie",
  "footer.feedback": "Dê sua opinião",
  "footer.legal": "Termos e Privacidade",
  "footer.curator": "Lista de espera do Tranquilo Curator",
  "language.label": "Idioma",

  "community.title": "Comunidade",
  "community.intro":
    "Tranquilo é feito de forma aberta, com a ajuda destas pessoas. Agradecemos de coração.",
  "community.contributors": "Contribuições no GitHub",
  "community.donors": "Apoio financeiro",
  "community.patrons": "Apoie no Patreon",
  "community.avatarAlt": "{handle} no GitHub",

  "form.joining": "Inscrevendo…",
  "form.error": "Algo deu errado — tente de novo em instantes.",
  "form.email": "E-mail",
  "form.emailPlaceholder": "voce@exemplo.com",
  "form.emailInvalid": "Digite um endereço de e-mail válido.",
  "about.notify.cta": "Notifique-me",
  "curator.cta": "Entrar na lista de espera",

  "feedback.sending": "Enviando…",
  "feedback.submit": "Enviar opinião",
  "feedback.error":
    "Sua mensagem não foi enviada, mas continua aqui. Tente de novo em instantes.",
  "submit.sending": "Enviando…",
  "submit.submit": "Enviar para avaliação",
  "submit.error": "Algo deu errado no envio. Tente de novo em instantes.",

  "newsletter.close": "Fechar",
  "newsletter.title": "Um momento de arte por mês",
  "newsletter.body": "Uma mensagem por mês com arte selecionada. Sem spam.",
  "newsletter.subscribe": "Inscrever-se",
  "newsletter.success":
    "Você está na lista. Fique de olho na nossa próxima mensagem.",

  "topbar.shareBanner.text":
    "Tranquilo é de código aberto e mantido por voluntários.",
  "topbar.shareBanner.newsletter": "Receber a newsletter",
  "topbar.shareBanner.involved": "Participe",
  "topbar.shareBanner.dismiss": "Fechar",
  "topbar.home": "Tranquilo, voltar ao início",
  "topbar.music": "Ligar ou desligar a música",
  "topbar.search": "Busca",
  "topbar.discover": "Descobrir prateleiras",
  "topbar.collection.label": "Minha coleção",
  "topbar.collection.empty": "Minha coleção, vazia",
  "topbar.collection.count.one": "Minha coleção, {count} obra",
  "topbar.collection.count.other": "Minha coleção, {count} obras",
  "topbar.filter.export": "Exportar",
  "topbar.filter.clear": "Mostrar tudo",
  "artistCard.wikipedia": "Leia mais na Wikipédia",
  "artistCard.wikidata": "Ver na Wikidata",

  "chips.all": "Todos",
  "chips.storyline": "Narrativa",
  "chips.more": "Mais",

  "facet.category.paintings-portraits": "Pinturas e retratos",
  "facet.category.sculpture-objects": "Esculturas e objetos",
  "facet.category.works-on-paper": "Obras em papel",
  "facet.category.arms-armor": "Armas e armaduras",
  "facet.category.photography": "Fotografia",

  "facet.region.europe": "Europa",
  "facet.region.east-asia": "Ásia Oriental",
  "facet.region.south-asia": "Ásia Meridional",
  "facet.region.southeast-asia": "Sudeste Asiático",
  "facet.region.west-asia-middle-east": "Ásia Ocidental e Oriente Médio",
  "facet.region.africa": "África",
  "facet.region.north-america": "América do Norte",
  "facet.region.latin-america-caribbean": "América Latina e Caribe",
  "facet.region.americas": "Américas",
  "facet.region.oceania": "Oceania",

  "facet.timeframe.ancient-classical": "Antiguidade",
  "facet.timeframe.medieval": "Idade Média",
  "facet.timeframe.renaissance": "Renascimento",
  "facet.timeframe.baroque-enlightenment": "Barroco e Iluminismo",
  "facet.timeframe.19th-century": "Século XIX",
  "facet.timeframe.modern-contemporary": "Moderno e contemporâneo",

  "facet.media_type.painting": "Pintura",
  "facet.media_type.print-drawing": "Gravura/desenho",
  "facet.media_type.photograph": "Fotografia",
  "facet.media_type.ceramic": "Cerâmica",
  "facet.media_type.metalwork": "Trabalho em metal",
  "facet.media_type.stone-sculpture": "Escultura em pedra",
  "facet.media_type.textile": "Têxtil",
  "facet.media_type.glass": "Vidro",
  "facet.media_type.decorative-object": "Objeto decorativo",

  "facet.palette.red": "Vermelho",
  "facet.palette.orange": "Laranja",
  "facet.palette.gold-yellow": "Dourado/amarelo",
  "facet.palette.green": "Verde",
  "facet.palette.teal": "Verde-azulado",
  "facet.palette.blue": "Azul",
  "facet.palette.purple": "Roxo",
  "facet.palette.pink": "Rosa",
  "facet.palette.neutral": "Neutro",

  "facet.subject_type.portrait": "Retrato",
  "facet.subject_type.religious": "Religioso",
  "facet.subject_type.landscape": "Paisagem",
  "facet.subject_type.genre-scene": "Cena de gênero",
  "facet.subject_type.still-life": "Natureza-morta",
  "facet.subject_type.other": "Outro",

  "caption.basic.untitled": "Sem título",
  "caption.basic.by": "de {artist}",
};
