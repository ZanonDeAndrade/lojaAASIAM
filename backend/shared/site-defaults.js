// Valores iniciais do editor. As publicacoes sao persistidas pelo backend.
export const SITE_DEFAULTS = {
  "brand": {
    "name": "AASIAM",
    "description": "Atlética de Sistemas de Informação",
    "logo": "/logo-aasiam.jpg",
    "title": "Loja oficial | AASIAM",
    "footer": "© 2026 AASIAM. Todos os direitos reservados.",
    "credits": "Desenvolvido por Arthur Zanon, Marcelo Telles e Milton Bortolanza."
  },
  "appearance": {
    "defaultTheme": "dark",
    "font": "Archivo",
    "radius": 22,
    "light": {
      "accent": "#46a758",
      "accentHover": "#3e9b4f",
      "background": "#fbfdfc",
      "panel": "#f7f9f8",
      "text": "#1a211e",
      "muted": "#63706b"
    },
    "dark": {
      "accent": "#46a758",
      "accentHover": "#53b365",
      "background": "#101211",
      "panel": "#171918",
      "text": "#eceeed",
      "muted": "#adb5b2"
    },
    "rocket": {
      "accent": "#62e88b",
      "background": "#101211",
      "panel": "#171918",
      "text": "#eceeed",
      "muted": "#adb5b2"
    },
    "churrasco": {
      "accent": "#3be477",
      "background": "#050806",
      "panel": "#0b120e",
      "text": "#f1f8f3",
      "muted": "#8fa795"
    }
  },
  "navigation": {
    "categories": [
      {
        "id": "moletom",
        "label": "Moletons"
      },
      {
        "id": "camiseta",
        "label": "Camisetas"
      },
      {
        "id": "acessorios",
        "label": "Acessórios"
      },
      {
        "id": "kits",
        "label": "Combos"
      }
    ],
    "rocket": {
      "label": "Botão 1",
      "href": "/torneio-rocket-league",
      "visible": true
    },
    "churrasco": {
      "label": "Botão 2",
      "href": "/churrasco-semana-academica",
      "visible": true
    }
  },
  "home": {
    "banners": [
      {
        "id": "churrasco-semana-academica",
        "titulo": "Churrasco da AASIAM na Semana Acadêmica",
        "href": "/churrasco-semana-academica",
        "src": "/imgs/banner-churrasco-semana-academica.png",
        "largura": 2172,
        "altura": 724,
        "alt": "Churrasco da AASIAM na Semana Acadêmica de Sistemas de Informação, 24/10: três lobos verdes da atlética assando carne, salsichão e frango numa churrasqueira. Abre a página de inscrição."
      },
      {
        "id": "torneio-rocket-league",
        "titulo": "Torneio Rocket League",
        "href": "/torneio-rocket-league",
        "src": "/imgs/banner-torneio-rocket-league.png",
        "largura": 1600,
        "altura": 584,
        "alt": "Torneio de Rocket League da AASIAM: o lobo da atlética pilota um carro verde em direção à bola num estádio iluminado. Abre a página de inscrição das equipes.",
        "primeiroAte": "2026-10-18T00:00:00-03:00"
      }
    ],
    "interval": 6000,
    "showBanners": true
  },
  "store": {
    "closed": true,
    "products": [
      {
        "id": "moletom-verde",
        "kind": "sizedVariants",
        "name": "Moletom Verde",
        "shortName": "Moletom Verde",
        "description": "Visual clássico e versátil, com a identidade da Alcateia estampada no peito. Conforto, estilo e orgulho de representar a AASIAM.",
        "priceCents": 16000,
        "tag": "Escolha o tamanho",
        "accent": "#12c86b",
        "hasHoodie": true,
        "variants": [
          {
            "code": "verde",
            "name": "Verde",
            "description": "Preto com verde neon da atlética.",
            "swatch": "#12c86b"
          }
        ],
        "sizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "images": [
          "imgs/moletom-verde.png"
        ],
        "costCents": 13000
      },
      {
        "id": "moletom-bege",
        "kind": "sizedVariants",
        "name": "Moletom Off-white",
        "shortName": "Moletom Off-white",
        "description": "Peça exclusiva com arte do lobo da Alcateia nas costas, representando força, união e pertencimento à AASIAM. Ideal para quem quer se destacar.",
        "priceCents": 16000,
        "tag": "Escolha o tamanho",
        "accent": "#c9b789",
        "hasHoodie": true,
        "variants": [
          {
            "code": "bege",
            "name": "Off-white",
            "description": "Base off-white com contraste preto e verde.",
            "swatch": "#c9b789"
          }
        ],
        "sizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "images": [
          "/imgs/moletom-off-white.png"
        ],
        "costCents": 13000
      },
      {
        "id": "kit-2-moletons",
        "kind": "doubleHoodie",
        "name": "Combo Essencial",
        "shortName": "Combo Essencial AASIAM",
        "description": "O Combo Essencial reúne as duas peças principais da Coleção Alcateia: o moletom verde e o moletom off-white. Uma combinação perfeita para quem quer ter as duas versões da coleção e representar a AASIAM em diferentes ocasiões, unindo conforto, estilo e identidade em um único pacote.",
        "priceCents": 29000,
        "tag": "Verde + Off-white",
        "accent": "#7fff8a",
        "includes": [
          "Moletom Verde",
          "Moletom Off-white"
        ],
        "variants": [
          {
            "code": "verde",
            "name": "Verde",
            "description": "Preto com verde neon da atlética.",
            "swatch": "#12c86b"
          },
          {
            "code": "bege",
            "name": "Off-white",
            "description": "Base off-white com contraste preto e verde.",
            "swatch": "#c9b789"
          }
        ],
        "sizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "defaultVerdeSize": "M",
        "defaultBegeSize": "M",
        "images": [
          "imgs/combo01.png",
          "/imgs/moletom-verde.png",
          "/imgs/moletom-off-white.png"
        ],
        "costCents": 26000
      },
      {
        "id": "kit-moletom-caneca",
        "kind": "configuredBundle",
        "name": "Combo Alcateia",
        "shortName": "Combo Alcateia",
        "description": "O Combo Alcateia foi pensado para quem deseja levar a experiência completa da atlética para o dia a dia. Além do moletom de sua escolha, o kit acompanha a caneca temática e o tirante exclusivo da coleção, criando uma combinação prática e cheia de personalidade para representar a AASIAM dentro e fora da faculdade.",
        "priceCents": 18500,
        "tag": "Combo",
        "accent": "#9ff34f",
        "includes": [
          "Moletom",
          "Caneca"
        ],
        "hasHoodie": true,
        "variants": [
          {
            "code": "verde",
            "name": "Verde",
            "description": "Preto com verde neon da atlética.",
            "swatch": "#12c86b"
          },
          {
            "code": "bege",
            "name": "Off-white",
            "description": "Base off-white com contraste preto e verde.",
            "swatch": "#c9b789"
          }
        ],
        "sizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "defaultHoodieVariant": "verde",
        "defaultHoodieSize": "M",
        "images": [
          "/imgs/combo02.png",
          "/imgs/moletom-verde.png",
          "/imgs/moletom-off-white.png",
          "/imgs/copo.png"
        ],
        "costCents": 15800
      },
      {
        "id": "caneca",
        "kind": "quantity",
        "name": "Caneca com tirante",
        "shortName": "Caneca",
        "description": "Kit exclusivo da AASIAM que reúne uma caneca temática e um tirante personalizado, ideal para representar a Alcateia em qualquer momento.",
        "priceCents": 4000,
        "tag": "Unitário",
        "accent": "#e8f7ef",
        "images": [
          "/imgs/copo.png"
        ],
        "costCents": 2800
      },
      {
        "id": "mochila-listras",
        "kind": "quantity",
        "name": "Mochila com Listras",
        "shortName": "Mochila Listras",
        "description": "Mochila esportiva exclusiva da AASIAM. As três listras verdes homenageiam a antiga camisa da Atlética, trazendo história e identidade para um modelo leve e versátil.",
        "priceCents": 4000,
        "tag": "Modelo listras",
        "soldOut": true,
        "accent": "#0b1110",
        "images": [
          "/imgs/mochila-listras.png"
        ],
        "costCents": 3500
      },
      {
        "id": "mochila-estampa",
        "kind": "quantity",
        "name": "Mochila com Estampa",
        "shortName": "Mochila Estampa",
        "description": "Modelo exclusivo com estampa de lobos em tom sobre tom, combinando identidade, estilo e funcionalidade para representar a Alcateia em qualquer ocasião.",
        "priceCents": 4000,
        "tag": "Modelo estampa",
        "soldOut": true,
        "accent": "#0b1110",
        "images": [
          "/imgs/mochila-estampa.png"
        ],
        "costCents": 3500
      },
      {
        "id": "camiseta-aasiam",
        "kind": "personalizedProduct",
        "name": "Camiseta AASIAM 2026",
        "shortName": "Camiseta 2026",
        "description": "Camiseta oficial AASIAM — Forfan, dry-tech.",
        "priceCents": 9000,
        "tag": "Escolha o tamanho",
        "accent": "#12c86b",
        "sizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "attributes": [
          {
            "key": "size",
            "label": "Tamanho",
            "options": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "chipLabel": "Tam. {value}"
          }
        ],
        "personalization": {
          "noun": "camiseta"
        },
        "images": [
          "/imgs/camiseta-aasiam.png"
        ],
        "costCents": 8000
      },
      {
        "id": "camiseta-goleiro-aasiam",
        "kind": "personalizedProduct",
        "name": "Camiseta Goleiro AASIAM 2026",
        "shortName": "Camiseta Goleiro 2026",
        "description": "Camiseta oficial de goleiro da Atlética de Sistemas da AMF 2026.",
        "priceCents": 9000,
        "tag": "Escolha o tamanho",
        "accent": "#12c86b",
        "sizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "attributes": [
          {
            "key": "size",
            "label": "Tamanho",
            "options": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "chipLabel": "Tam. {value}"
          }
        ],
        "personalization": {
          "noun": "camiseta"
        },
        "images": [
          "/imgs/camiseta-aasiam-goleiro.png"
        ],
        "costCents": 8000
      },
      {
        "id": "conjunto-chumbo",
        "kind": "personalizedProduct",
        "name": "Conjunto Chumbo AASIAM",
        "shortName": "Conjunto Chumbo AASIAM",
        "description": "Conjunto oficial AASIAM com camiseta e calção.",
        "priceCents": 14000,
        "tag": "Camiseta + calção",
        "accent": "#303438",
        "shirtSizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "shortsSizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "attributes": [
          {
            "key": "shirtSize",
            "label": "Tamanho da camiseta",
            "options": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "chipLabel": "Camiseta {value}"
          },
          {
            "key": "shortsSize",
            "label": "Tamanho do calção",
            "options": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "chipLabel": "Calção {value}"
          }
        ],
        "personalization": {
          "noun": "camiseta"
        },
        "images": [
          "/imgs/conjunto chumbo.png"
        ],
        "costCents": 13000
      },
      {
        "id": "conjunto-verde",
        "kind": "personalizedProduct",
        "name": "Conjunto Verde AASIAM",
        "shortName": "Conjunto Verde AASIAM",
        "description": "Conjunto oficial AASIAM com camiseta e calção.",
        "priceCents": 14000,
        "tag": "Camiseta + calção",
        "accent": "#12c86b",
        "shirtSizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "shortsSizes": [
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "XG"
        ],
        "attributes": [
          {
            "key": "shirtSize",
            "label": "Tamanho da camiseta",
            "options": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "chipLabel": "Camiseta {value}"
          },
          {
            "key": "shortsSize",
            "label": "Tamanho do calção",
            "options": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "chipLabel": "Calção {value}"
          }
        ],
        "personalization": {
          "noun": "camiseta"
        },
        "images": [
          "/imgs/conjunto verde.png"
        ],
        "costCents": 13000
      },
      {
        "id": "jersey",
        "kind": "personalizedProduct",
        "name": "Jersey AASIAM",
        "shortName": "Jersey AASIAM",
        "description": "Jersey oficial AASIAM.",
        "priceCents": 15000,
        "tag": "Escolha o tamanho",
        "accent": "#12c86b",
        "variants": [
          {
            "code": "branca",
            "name": "Branca",
            "swatch": "#f4f1e8",
            "border": "#b9b2a2"
          },
          {
            "code": "preta",
            "name": "Preta",
            "swatch": "#252426"
          }
        ],
        "sizes": [
          "3P",
          "PP",
          "P",
          "M",
          "G",
          "GG",
          "3G"
        ],
        "sizeGuide": "jersey",
        "attributes": [
          {
            "key": "color",
            "label": "Cor",
            "options": [
              {
                "code": "branca",
                "name": "Branca",
                "swatch": "#f4f1e8",
                "border": "#b9b2a2"
              },
              {
                "code": "preta",
                "name": "Preta",
                "swatch": "#252426"
              }
            ],
            "chipLabel": "{name}"
          },
          {
            "key": "size",
            "label": "Tamanho",
            "options": [
              "3P",
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "3G"
            ],
            "chipLabel": "Tam. {value}"
          }
        ],
        "personalization": {
          "noun": "Jersey"
        },
        "images": [
          "/imgs/jerseys.png"
        ],
        "costCents": 14000
      },
      {
        "id": "manta",
        "kind": "quantity",
        "name": "Cachecol",
        "shortName": "Manta",
        "description": "Cachecol oficial da AASIAM, desenvolvido para demonstrar orgulho e pertencimento. Perfeito para eventos, competições e momentos de integração da Atlética.",
        "priceCents": 5000,
        "tag": "Conforto",
        "soldOut": true,
        "accent": "#213a2c",
        "images": [
          "/imgs/manta.png"
        ],
        "costCents": 5000
      },
      {
        "id": "combo-signature",
        "kind": "multiPieceBundle",
        "name": "Combo Signature",
        "shortName": "Combo Signature",
        "description": "O Combo Signature fecha duas camisetas da Coleção Alcateia numa cartela única: uma verde e uma chumbo. As cores são fixas; escolha tamanho, nome e número de cada camiseta separadamente.",
        "priceCents": 16000,
        "tag": "2 camisetas",
        "accent": "#0b5149",
        "includes": [
          "Camiseta Verde",
          "Camiseta Chumbo"
        ],
        "pieces": [
          {
            "key": "greenShirt",
            "name": "Camiseta Verde",
            "colors": [
              {
                "code": "verde",
                "name": "Verde",
                "swatch": "#0b5149"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "personalization": {
              "noun": "camiseta"
            }
          },
          {
            "key": "charcoalShirt",
            "name": "Camiseta Chumbo",
            "colors": [
              {
                "code": "chumbo",
                "name": "Chumbo",
                "swatch": "#303438"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "personalization": {
              "noun": "camiseta"
            }
          }
        ],
        "coverImage": "/imgs/combo-signature.png",
        "coverAspect": "4 / 5",
        "galleryFit": "contain",
        "images": [
          "/imgs/camiseta-aasiam.png"
        ],
        "costCents": 16000
      },
      {
        "id": "combo-territorio",
        "kind": "multiPieceBundle",
        "name": "Combo Território",
        "shortName": "Combo Território",
        "description": "O Combo Território junta a Jersey oficial da Alcateia à caneca com tirante da coleção. Escolha cor, tamanho, nome e número da Jersey; a caneca acompanha o kit.",
        "priceCents": 18000,
        "tag": "Jersey + Caneca",
        "accent": "#12c86b",
        "includes": [
          "Jersey",
          "Caneca com tirante"
        ],
        "pieces": [
          {
            "key": "jersey",
            "name": "Jersey",
            "colors": [
              {
                "code": "branca",
                "name": "Branca",
                "swatch": "#f4f1e8",
                "border": "#b9b2a2"
              },
              {
                "code": "preta",
                "name": "Preta",
                "swatch": "#252426"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "personalization": {
              "noun": "Jersey"
            }
          }
        ],
        "fixedItems": [
          {
            "name": "Caneca com tirante",
            "quantity": 1
          }
        ],
        "coverImage": "/imgs/combo-territorio.png",
        "coverAspect": "4 / 5",
        "galleryFit": "contain",
        "images": [
          "/imgs/jerseys.png",
          "/imgs/copo.png"
        ],
        "costCents": 16800
      },
      {
        "id": "combo-dominio",
        "kind": "multiPieceBundle",
        "name": "Combo Domínio",
        "shortName": "Combo Domínio",
        "description": "O Combo Domínio reúne o moletom e a camiseta da Coleção Alcateia. Escolha a cor e o tamanho do moletom, a cor e o tamanho da camiseta, e personalize a camiseta com nome e número.",
        "priceCents": 23000,
        "tag": "Moletom + Camiseta",
        "accent": "#12c86b",
        "includes": [
          "Moletom",
          "Camiseta"
        ],
        "pieces": [
          {
            "key": "hoodie",
            "name": "Moletom",
            "colors": [
              {
                "code": "verde",
                "name": "Verde",
                "description": "Preto com verde neon da atlética.",
                "swatch": "#12c86b"
              },
              {
                "code": "bege",
                "name": "Off-white",
                "description": "Base off-white com contraste preto e verde.",
                "swatch": "#c9b789"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ]
          },
          {
            "key": "shirt",
            "name": "Camiseta",
            "colors": [
              {
                "code": "verde",
                "name": "Verde",
                "swatch": "#0b5149"
              },
              {
                "code": "chumbo",
                "name": "Chumbo",
                "swatch": "#303438"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "personalization": {
              "noun": "camiseta"
            }
          }
        ],
        "coverImage": "/imgs/combo-dominio.png",
        "coverAspect": "4 / 5",
        "galleryFit": "contain",
        "images": [
          "/imgs/moletom-verde.png",
          "/imgs/moletom-off-white.png",
          "/imgs/camiseta-aasiam.png"
        ],
        "costCents": 21000
      },
      {
        "id": "combo-wolf",
        "kind": "multiPieceBundle",
        "name": "Combo Wolf",
        "shortName": "Combo Wolf",
        "description": "O Combo Wolf reúne quatro peças da Coleção Alcateia em um único kit: moletom, camiseta, caneca com tirante e Jersey. Escolha as cores e tamanhos das peças para representar a AASIAM dentro e fora da faculdade.",
        "priceCents": 41500,
        "tag": "4 peças",
        "accent": "#18f08a",
        "includes": [
          "Moletom",
          "Camiseta",
          "Caneca com tirante",
          "Jersey"
        ],
        "pieces": [
          {
            "key": "hoodie",
            "name": "Moletom",
            "colors": [
              {
                "code": "verde",
                "name": "Verde",
                "description": "Preto com verde neon da atlética.",
                "swatch": "#12c86b"
              },
              {
                "code": "bege",
                "name": "Off-white",
                "description": "Base off-white com contraste preto e verde.",
                "swatch": "#c9b789"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ]
          },
          {
            "key": "shirt",
            "name": "Camiseta",
            "colors": [
              {
                "code": "verde",
                "name": "Verde",
                "swatch": "#0b5149"
              },
              {
                "code": "chumbo",
                "name": "Chumbo",
                "swatch": "#303438"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ],
            "personalization": {
              "noun": "camiseta"
            }
          },
          {
            "key": "jersey",
            "name": "Jersey",
            "colors": [
              {
                "code": "branca",
                "name": "Branca",
                "swatch": "#f4f1e8",
                "border": "#b9b2a2"
              },
              {
                "code": "preta",
                "name": "Preta",
                "swatch": "#252426"
              }
            ],
            "sizes": [
              "PP",
              "P",
              "M",
              "G",
              "GG",
              "XG"
            ]
          }
        ],
        "fixedItems": [
          {
            "name": "Caneca com tirante",
            "quantity": 1
          }
        ],
        "coverImage": "/imgs/wolfc.png",
        "coverAspect": "4 / 5",
        "galleryFit": "contain",
        "images": [
          "/imgs/moletom-verde.png",
          "/imgs/camiseta-aasiam.png",
          "/imgs/jerseys.png",
          "/imgs/copo.png"
        ],
        "costCents": 37800
      }
    ]
  },
  "media": [],
  "rocket": {
    "registration": {
      "enabled": true,
      "amountCents": 5000,
      "deadline": "2026-10-17T23:59:59.999-03:00"
    },
    "title": "Torneio Rocket League 2x2",
    "subtitle": "Monte sua dupla e entre na arena.",
    "banner": "/imgs/banner-torneio-rocket-league.png",
    "bannerAlt": "Arte oficial do Torneio de Rocket League da AASIAM",
    "registerLabel": "Inscrever equipe",
    "aboutTitle": "Grupos e mata-mata online, grande final presencial",
    "aboutDescription": "Rocket League 2x2 promovido pela AASIAM — Alcateia de Chernobyl. As equipes inscritas se enfrentam em grupos e mata-mata online; a grande final acontece presencialmente na faculdade.",
    "info": [
      {
        "label": "Valor por equipe",
        "value": "R$ 50,00",
        "hint": "Com ou sem reserva"
      },
      {
        "label": "Prazo de inscrição",
        "value": "17/10/2026",
        "hint": "Até 23:59 (horário de Brasília)"
      },
      {
        "label": "Modalidade",
        "value": "2x2",
        "hint": "Sem limite de equipes"
      }
    ],
    "prizes": [
      {
        "place": "1º lugar",
        "medal": "ouro",
        "text": "1 troféu, 2 medalhas e 2 Jerseys AASIAM.",
        "note": "Imagem do troféu meramente ilustrativa. O modelo final pode sofrer alterações.",
        "image": "/imgs/premio-1o-lugar",
        "alt": "Premiação do 1º lugar: troféu, duas jerseys oficiais da AASIAM e medalhas"
      },
      {
        "place": "2º lugar",
        "medal": "prata",
        "text": "2 medalhas e 2 camisetas AASIAM.",
        "note": "Imagens das medalhas meramente ilustrativas. Os modelos finais podem sofrer alterações.",
        "image": "/imgs/premio-2o-lugar",
        "alt": "Premiação do 2º lugar: duas camisas oficiais da AASIAM e medalhas"
      },
      {
        "place": "3º lugar",
        "medal": "bronze",
        "text": "2 medalhas e 2 canecas AASIAM.",
        "note": "Imagens das medalhas meramente ilustrativas. Os modelos finais podem sofrer alterações.",
        "image": "/imgs/premio-3o-lugar",
        "alt": "Premiação do 3º lugar: duas canecas com tirante da AASIAM e medalhas"
      }
    ],
    "regulation": [
      {
        "title": "1. Organização e apresentação",
        "paragraphs": [
          "O presente regulamento rege o campeonato de Rocket League 2x2 promovido pela AASIAM (Associação Atlética de Sistemas de Informação Antonio Meneghetti - Alcateia de Chernobyl). O evento tem como objetivos integrar a comunidade acadêmica, fomentar os e-sports na instituição e arrecadar fundos para as iniciativas da atlética."
        ]
      },
      {
        "title": "2. Inscrições, elegibilidade e jogador reserva",
        "items": [
          {
            "label": "Composição da Equipe",
            "text": "Cada equipe deve ser formada obrigatoriamente por 2 (dois) jogadores titulares."
          },
          {
            "label": "Atleta Reserva (Opcional)",
            "text": "A inscrição de 1 (um) jogador reserva por equipe é totalmente opcional, não sendo obrigatória para a participação no campeonato. Caso inscrito, o reserva deve ser cadastrado previamente junto aos titulares."
          },
          {
            "label": "Requisito Acadêmico",
            "text": "Todos os integrantes (titulares e eventuais reservas) devem ser alunos atuais, professores ou egressos (ex-alunos) da instituição de ensino."
          },
          {
            "label": "Dados Obrigatórios",
            "text": "No ato da inscrição, a equipe deve fornecer: Nome da Equipe, Nome Completo e RA de todos os integrantes (e do reserva, se houver), além do contato do capitão."
          },
          {
            "label": "Confirmação de Vaga",
            "text": "A inscrição é validada estritamente mediante o envio do comprovante de pagamento da taxa de R$ 50,00 aos canais oficiais da AASIAM (https://www.aasiam.com.br/) até 17/10/2026."
          }
        ],
        "callout": "Atenção: Vagas limitadas a 20 equipes. O preenchimento obedece à ordem de envio do comprovante de pagamento à organização."
      },
      {
        "title": "3. Formato do campeonato e sistema de pontuação",
        "items": [
          {
            "label": "Fase de Grupos (Online)",
            "text": "As 20 equipes serão divididas em 4 grupos de 5 equipes. Todos jogam contra todos em partida única. Cada vitória soma +1 ponto na tabela de classificação. Para agilidade, 4 partidas simultâneas ocorrerão por blocos de horários. Avançam os 2 melhores de cada grupo (Total: 8 equipes)."
          },
          {
            "label": "Critérios de Desempate (Fase de Grupos)",
            "text": "Em caso de empate em pontos entre duas ou mais equipes, os critérios aplicados em ordem estrita são:",
            "list": [
              "1) Confronto Direto;",
              "2) Saldo de Gols (SG);",
              "3) Maior Número de Gols Marcados (GM);",
              "4) Menor Número de Gols Sofridos (GS);",
              "5) Partida de desempate (Tiebreaker) organizada pela Comissão Organizador."
            ]
          },
          {
            "label": "Quartas de Final e Semifinais (Online)",
            "text": "Sistema eliminatório simples em MD3 (Melhor de 3 partidas)."
          },
          {
            "label": "Grande Final (Presencial)",
            "text": "Realizada na faculdade em confronto decisivo MD5 (Melhor de 5 partidas)."
          }
        ]
      },
      {
        "title": "4. Regras de queda de conexão e W.O.",
        "callout": "Regra de Queda de Conexão: Se houver queda de conexão, a partida será reiniciada mantendo o placar atual proporcional ao momento da queda. Caso a queda ocorra com menos de 1 minuto de jogo decorrido, a partida será reiniciada do zero. Se a queda do mesmo jogador ocorrer mais de uma vez na mesma série, o uso do jogador reserva (caso cadastrado) será obrigatório para a continuidade.",
        "calloutFirst": true,
        "items": [
          {
            "label": "Regra Rigorosa de W.O.",
            "text": "Tolerância máxima de 15 minutos a partir do horário oficial da partida. A ausência de jogadores suficientes acarreta W.O. (derrota por 1x0) ou seja o time que ganhar a partida por W.O soma +1 ponto e +1x gol para o saldo de gols, consequentemente a equipe penalizada por W.O não soma pontos e recebe -1 gol no saldo de gols."
          },
          {
            "label": "Conduta e Integridade",
            "text": "Ofensas no chat, toxicidade ou tentativas de burlar regras resultam em advertência e desclassificação imediata sem reembolso."
          }
        ]
      },
      {
        "title": "5. Premiação oficial",
        "items": [
          {
            "icon": "Trophy",
            "label": "1º Lugar (Campeões)",
            "text": "1 troféu, 2 medalhas e 2 Jerseys AASIAM."
          },
          {
            "icon": "Medal",
            "label": "2º Lugar (Vice-campeões)",
            "text": "2 medalhas e 2 camisetas AASIAM."
          },
          {
            "icon": "Award",
            "label": "3º Lugar",
            "text": "2 medalhas e 2 canecas AASIAM."
          }
        ]
      }
    ],
    "regulationUrl": "",
    "schedule": {
      "day": "18 de outubro de 2026 · Início às 15h · Os três grupos jogam simultaneamente"
    },
    "qualification": "Avançam o 1º e o 2º colocados de cada grupo e os 2 melhores 3º colocados entre os grupos A, B e C, totalizando 8 equipes.",
    "groupNote": "Vitória vale 3 pontos e derrota, 0 (não há empate: a prorrogação define o vencedor). Desempate: pontos, saldo de gols, gols marcados e confronto direto; persistindo o empate, sorteio pela organização.",
    "bracketNote": "Os confrontos das quartas são definidos pela organização ao fim da fase de grupos. O vencedor de cada série avança automaticamente.",
    "registrationTab": "Sobre e inscrições",
    "gamesTab": "Jogos e classificação"
  },
  "events": {
    "amf-games-2026": {
      "titulo": "Churrasco da Alcateia",
      "subtitulo": "",
      "tituloDaAba": "Churrasco da Alcateia | AASIAM",
      "data": "",
      "horario": "",
      "local": "",
      "cardapio": [],
      "banner": null,
      "dicaDoFormulario": "Quatro campos e pronto. O valor vem do seu curso e o pagamento é por Pix, aqui mesmo nesta página."
    },
    "semana-si-2026": {
      "titulo": "Churrasco da AASIAM",
      "subtitulo": "Semana Acadêmica de Sistemas de Informação",
      "tituloDaAba": "Churrasco da AASIAM — Semana Acadêmica de SI | AASIAM",
      "data": "24/10/2026",
      "horario": "A partir das 11h para quem precisar de transporte poder participar",
      "local": "Projeto Terra",
      "cardapio": [
        "Pão",
        "Salsichão",
        "Refri"
      ],
      "banner": {
        "src": "/imgs/banner-churrasco-semana-academica.png",
        "largura": 2172,
        "altura": 724,
        "alt": "Churrasco da AASIAM na Semana Acadêmica de Sistemas de Informação, 24/10: três lobos verdes da atlética, com o emblema SI no peito, assando carne, salsichão e frango numa churrasqueira ao ar livre."
      },
      "dicaDoFormulario": "Três campos e pronto. R$ 20,00 por pessoa, pago por Pix aqui mesmo nesta página."
    }
  },
  "barbecue": {
    "subtitulo": "Garanta sua participação no churrasco da Atlética de Sistemas de Informação.",
    "image": {
      "fallback": "/imgs/lobo-churrasco-transparente.png",
      "width": 1137,
      "height": 1201,
      "alt": "Mascote da Atlética de Sistemas de Informação: um lobo musculoso de pelagem verde, com o emblema \"SI\" no peito, assando carnes, linguiças e frango em uma churrasqueira."
    }
  }
};
