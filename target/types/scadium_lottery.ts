/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/scadium_lottery.json`.
 */
export type ScadiumLottery = {
  "address": "3HHxLKiAW4JhSHaPSKpjCqCxpQgPfTd8pP6tzL8ZAVk5",
  "metadata": {
    "name": "scadiumLottery",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Scadium on-chain PancakeSwap-style 6-digit $SCAD lottery"
  },
  "instructions": [
    {
      "name": "burnPool",
      "docs": [
        "Cosigner burns the round's treasury slice (PancakeSwap's treasuryFee) —",
        "a real SPL token burn that reduces $SCAD supply, like CAKE's burn."
      ],
      "discriminator": [
        83,
        255,
        250,
        102,
        206,
        12,
        83,
        176
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "treasuryScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "scadMint",
          "writable": true
        },
        {
          "name": "cosigner",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buyTicket",
      "docs": [
        "USER-signed ticket purchase: `ticket_price` $SCAD → treasury, picks in the event."
      ],
      "discriminator": [
        11,
        24,
        17,
        193,
        168,
        116,
        164,
        169
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "buyerScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasuryScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "scadMint"
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "digits",
          "type": {
            "array": [
              "u8",
              6
            ]
          }
        }
      ]
    },
    {
      "name": "buyTickets",
      "docs": [
        "USER-signed BATCH purchase: up to [`MAX_TICKETS_PER_TX`] tickets in a",
        "single transaction — one $SCAD transfer of the PancakeSwap bulk-discount",
        "total, one `TicketBought` event per ticket (same shape as `buy_ticket`,",
        "so off-chain confirmation parses both identically)."
      ],
      "discriminator": [
        48,
        16,
        122,
        137,
        24,
        214,
        198,
        58
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "buyerScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasuryScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "scadMint"
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "picks",
          "type": {
            "vec": {
              "defined": {
                "name": "ticketPick"
              }
            }
          }
        }
      ]
    },
    {
      "name": "commitDraw",
      "docs": [
        "Cosigner publishes the seed commitment before sales open."
      ],
      "discriminator": [
        210,
        106,
        32,
        68,
        253,
        95,
        229,
        1
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "cosigner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "serverSeedHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "drawAt",
          "type": "i64"
        },
        {
          "name": "targetSlot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initLottery",
      "discriminator": [
        255,
        2,
        161,
        251,
        245,
        9,
        57,
        232
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "scadMint"
        },
        {
          "name": "treasuryScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "cosigner",
          "type": "pubkey"
        },
        {
          "name": "ticketPrice",
          "type": "u64"
        },
        {
          "name": "discountDivisor",
          "type": "u64"
        }
      ]
    },
    {
      "name": "inject",
      "docs": [
        "Cosigner tops up a round's pool with house $SCAD (PancakeSwap injection)."
      ],
      "discriminator": [
        188,
        37,
        35,
        173,
        125,
        222,
        85,
        174
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "injectorScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "cosigner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasuryScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "scadMint"
        },
        {
          "name": "cosigner",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "payPrize",
      "docs": [
        "Cosigner pays a winner its (equal) share of a bracket's slice. Idempotent",
        "per (draw, winner): the `Payout` PDA `init` fails on a replay."
      ],
      "discriminator": [
        80,
        130,
        106,
        28,
        177,
        138,
        226,
        26
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "winner"
        },
        {
          "name": "payout",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  111,
                  117,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              },
              {
                "kind": "account",
                "path": "winner"
              }
            ]
          }
        },
        {
          "name": "treasuryScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "winnerScad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "winner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "scadMint"
        },
        {
          "name": "cosigner",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "bracket",
          "type": "u8"
        }
      ]
    },
    {
      "name": "revealDraw",
      "docs": [
        "Cosigner reveals the seed; the program checks the commitment, requires the",
        "SlotHashes entry for the slot PINNED at commit (`draw.target_slot`), and",
        "derives the 6-digit winning number ITSELF from that hash — the cosigner",
        "only supplies the preimage of its own commitment and cannot grind which",
        "slot seeds the draw by choosing when to reveal."
      ],
      "discriminator": [
        13,
        149,
        75,
        226,
        184,
        105,
        114,
        48
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "draw",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  114,
                  97,
                  119
                ]
              },
              {
                "kind": "arg",
                "path": "drawIndex"
              }
            ]
          }
        },
        {
          "name": "cosigner",
          "signer": true
        },
        {
          "name": "slotHashes",
          "docs": [
            "(the full sysvar is too large for Anchor's typed deserialization)."
          ],
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "drawIndex",
          "type": "u64"
        },
        {
          "name": "serverSeed",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "draw",
      "discriminator": [
        225,
        131,
        41,
        222,
        122,
        20,
        146,
        202
      ]
    },
    {
      "name": "lotteryConfig",
      "discriminator": [
        174,
        54,
        184,
        175,
        81,
        20,
        237,
        24
      ]
    },
    {
      "name": "payout",
      "discriminator": [
        69,
        45,
        245,
        131,
        218,
        101,
        158,
        228
      ]
    }
  ],
  "events": [
    {
      "name": "drawCommitted",
      "discriminator": [
        228,
        156,
        123,
        212,
        154,
        211,
        83,
        218
      ]
    },
    {
      "name": "drawRevealed",
      "discriminator": [
        255,
        27,
        67,
        160,
        9,
        247,
        91,
        185
      ]
    },
    {
      "name": "fundsInjected",
      "discriminator": [
        118,
        190,
        188,
        163,
        225,
        226,
        182,
        91
      ]
    },
    {
      "name": "poolBurned",
      "discriminator": [
        166,
        237,
        118,
        39,
        30,
        169,
        127,
        59
      ]
    },
    {
      "name": "prizePaid",
      "discriminator": [
        6,
        20,
        237,
        248,
        90,
        77,
        102,
        211
      ]
    },
    {
      "name": "ticketBought",
      "discriminator": [
        80,
        244,
        35,
        181,
        211,
        143,
        3,
        166
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notCosigner",
      "msg": "Signer is not the registered cosigner"
    },
    {
      "code": 6001,
      "name": "wrongDraw",
      "msg": "Draw index mismatch"
    },
    {
      "code": 6002,
      "name": "drawClosed",
      "msg": "Draw is not open"
    },
    {
      "code": 6003,
      "name": "seedMismatch",
      "msg": "Revealed seed does not match the commitment"
    },
    {
      "code": 6004,
      "name": "invalidPick",
      "msg": "Invalid number picks"
    },
    {
      "code": 6005,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6006,
      "name": "tooManyTickets",
      "msg": "Too many tickets in one transaction"
    },
    {
      "code": 6007,
      "name": "slotHashUnavailable",
      "msg": "SlotHashes sysvar is empty or unreadable"
    },
    {
      "code": 6008,
      "name": "invalidConfig",
      "msg": "Invalid lottery configuration"
    },
    {
      "code": 6009,
      "name": "invalidBracket",
      "msg": "Bracket out of range"
    },
    {
      "code": 6010,
      "name": "targetSlotNotFuture",
      "msg": "Pinned target slot must be in the future at commit time"
    },
    {
      "code": 6011,
      "name": "targetSlotNotAvailable",
      "msg": "The pinned target slot is not in the SlotHashes window (not yet reached or rolled out)"
    }
  ],
  "types": [
    {
      "name": "draw",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "serverSeedHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "clientSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "revealedSeed",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "slotHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "finalEntropy",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "winningDigits",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "drawAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "drawStatus"
              }
            }
          },
          {
            "name": "ticketCount",
            "type": "u32"
          },
          {
            "name": "targetSlot",
            "docs": [
              "Slot PINNED at commit time (#19b). `reveal_draw` must derive from THIS",
              "slot's SlotHashes entry — not the newest — so the cosigner cannot grind",
              "the reveal over recent slots. Appended at the end of the account so the",
              "pre-existing field byte-offsets stay stable for off-chain readers."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "drawCommitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "serverSeedHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "clientSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "drawAt",
            "type": "i64"
          },
          {
            "name": "targetSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "drawRevealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "serverSeed",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "slotHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "finalEntropy",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "digits",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "drawStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "revealed"
          }
        ]
      }
    },
    {
      "name": "fundsInjected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lotteryConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "cosigner",
            "type": "pubkey"
          },
          {
            "name": "scadMint",
            "type": "pubkey"
          },
          {
            "name": "ticketPrice",
            "type": "u64"
          },
          {
            "name": "discountDivisor",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "payout",
      "docs": [
        "Idempotency + audit record for a paid prize (one per draw+winner)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "bracket",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolBurned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "prizePaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bracket",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ticketBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "drawIndex",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "digits",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ticketPick",
      "docs": [
        "One ticket's picks inside a `buy_tickets` batch."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "digits",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    }
  ]
};
