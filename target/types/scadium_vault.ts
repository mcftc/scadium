/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/scadium_vault.json`.
 */
export type ScadiumVault = {
  "address": "DSQJ8FX8JGhB2nKPGVM2ptWZydskNmp8629C8HXTvrqr",
  "metadata": {
    "name": "scadiumVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Scadium custody + settlement + reward claims"
  },
  "instructions": [
    {
      "name": "claimDividend",
      "docs": [
        "Cosigner-signed: pay a staker's USDS dividend for a distribution round.",
        "Mirrors `claim_reward` but moves the USDS mint instead of $SCAD. The",
        "ClaimRecord PDA seed includes `RewardKind::Dividend` + `period`, so a",
        "given (user, round) is paid at most once on chain — the same double-pay",
        "guard the off-chain DistributionClaim @@unique enforces."
      ],
      "discriminator": [
        15,
        29,
        207,
        120,
        153,
        178,
        164,
        91
      ],
      "accounts": [
        {
          "name": "house",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "claimRecord",
          "writable": true
        },
        {
          "name": "user"
        },
        {
          "name": "usdsTreasuryAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "house"
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
                "path": "usdsMint"
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
          "name": "userAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
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
                "path": "usdsMint"
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
          "name": "usdsMint"
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
          "name": "period",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimReward",
      "docs": [
        "Cosigner-signed $SCAD reward claim from the rewards treasury.",
        "A ClaimRecord PDA keyed by (user, kind, period) blocks double-claims."
      ],
      "discriminator": [
        149,
        95,
        181,
        242,
        94,
        90,
        158,
        162
      ],
      "accounts": [
        {
          "name": "house",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "claimRecord",
          "writable": true
        },
        {
          "name": "user"
        },
        {
          "name": "treasuryAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "house"
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
          "name": "userAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
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
          "name": "kind",
          "type": {
            "defined": {
              "name": "rewardKind"
            }
          }
        },
        {
          "name": "period",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "User-signed: move SOL from the user's wallet into their vault PDA."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "userVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
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
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initHouse",
      "discriminator": [
        179,
        199,
        91,
        87,
        163,
        192,
        163,
        183
      ],
      "accounts": [
        {
          "name": "house",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "houseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "scadMint"
        },
        {
          "name": "usdsMint",
          "docs": [
            "SCAD Engine: the USD-pegged dividend mint stakers are paid in."
          ]
        },
        {
          "name": "authority",
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
          "name": "cosigner",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initVaultPool",
      "docs": [
        "Authority-signed: create a term pool + its $SCAD vault token account."
      ],
      "discriminator": [
        149,
        100,
        90,
        51,
        203,
        187,
        233,
        177
      ],
      "accounts": [
        {
          "name": "house",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "scadMint"
              },
              {
                "kind": "arg",
                "path": "termDays"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
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
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "house"
          ]
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
          "name": "termDays",
          "type": "u32"
        },
        {
          "name": "weightBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "recordBet",
      "docs": [
        "Cosigner-signed PLAY-MONEY receipt (#26): records a bet outcome on",
        "chain WITHOUT moving any lamports. Deliberately a separate instruction",
        "+ event from `settle_bet`, so a value-bearing settlement receipt can",
        "never be confused with a play-money record on an explorer."
      ],
      "discriminator": [
        138,
        165,
        80,
        175,
        196,
        248,
        195,
        63
      ],
      "accounts": [
        {
          "name": "house",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "user"
        },
        {
          "name": "cosigner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "betId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "game",
          "type": {
            "defined": {
              "name": "gameType"
            }
          }
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "multiplierBps",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "house",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "house"
          ]
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleBet",
      "docs": [
        "Cosigner-signed AUTHORITATIVE settlement (#26): nets stake vs payout",
        "between the user vault and the house vault, moving REAL lamports. The",
        "BetSettled event amounts are guaranteed equal to the value netted — a",
        "loss the vault cannot cover above rent REVERTS (InsufficientFunds)",
        "instead of emitting a full-amount receipt for a partial/zero transfer.",
        "Play-money rounds must use `record_bet` (an explicitly non-value",
        "receipt) instead."
      ],
      "discriminator": [
        115,
        55,
        234,
        177,
        227,
        4,
        10,
        67
      ],
      "accounts": [
        {
          "name": "house",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "houseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "userVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user"
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
          "name": "betId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "game",
          "type": {
            "defined": {
              "name": "gameType"
            }
          }
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "multiplierBps",
          "type": "u32"
        }
      ]
    },
    {
      "name": "vaultAccrue",
      "docs": [
        "Cosigner-signed: add `amount` $SCAD yield to a pool, raising its index for",
        "all current stakers. Funds come from the house treasury ATA."
      ],
      "discriminator": [
        39,
        1,
        196,
        99,
        200,
        215,
        234,
        53
      ],
      "accounts": [
        {
          "name": "house",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  117,
                  115,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.scad_mint",
                "account": "vaultPool"
              },
              {
                "kind": "account",
                "path": "pool.term_days",
                "account": "vaultPool"
              }
            ]
          }
        },
        {
          "name": "treasuryAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "house"
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
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
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
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "vaultDeposit",
      "docs": [
        "User-signed: lock $SCAD into a term pool, minting shares at the current",
        "index. First deposit locks MINIMUM_LIQUIDITY shares in the pool."
      ],
      "discriminator": [
        231,
        150,
        41,
        113,
        180,
        104,
        162,
        120
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.scad_mint",
                "account": "vaultPool"
              },
              {
                "kind": "account",
                "path": "pool.term_days",
                "account": "vaultPool"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
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
          "name": "userAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
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
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "vaultWithdraw",
      "docs": [
        "User-signed: withdraw `shares` from the caller's position. Before maturity",
        "an EARLY_EXIT_PENALTY_BPS cut is kept in the pool (raising the index)."
      ],
      "discriminator": [
        98,
        28,
        187,
        98,
        87,
        69,
        46,
        64
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.scad_mint",
                "account": "vaultPool"
              },
              {
                "kind": "account",
                "path": "pool.term_days",
                "account": "vaultPool"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
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
          "name": "userAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
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
          "name": "user",
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
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "User-signed ONLY. The non-custodial guarantee: nothing but the owner's",
        "signature is required, and rent-exemption is preserved."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "userVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "claimRecord",
      "discriminator": [
        57,
        229,
        0,
        9,
        65,
        62,
        96,
        7
      ]
    },
    {
      "name": "house",
      "discriminator": [
        21,
        145,
        94,
        109,
        254,
        199,
        210,
        151
      ]
    },
    {
      "name": "userVault",
      "discriminator": [
        23,
        76,
        96,
        159,
        210,
        10,
        5,
        22
      ]
    },
    {
      "name": "userVaultPosition",
      "discriminator": [
        22,
        199,
        180,
        190,
        212,
        24,
        137,
        103
      ]
    },
    {
      "name": "vaultPool",
      "discriminator": [
        64,
        55,
        145,
        17,
        146,
        105,
        18,
        195
      ]
    }
  ],
  "events": [
    {
      "name": "betRecorded",
      "discriminator": [
        203,
        197,
        68,
        83,
        161,
        6,
        163,
        208
      ]
    },
    {
      "name": "betSettled",
      "discriminator": [
        57,
        145,
        224,
        160,
        62,
        119,
        227,
        206
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "rewardClaimed",
      "discriminator": [
        49,
        28,
        87,
        84,
        158,
        48,
        229,
        175
      ]
    },
    {
      "name": "vaultAccrued",
      "discriminator": [
        77,
        57,
        146,
        112,
        181,
        247,
        179,
        18
      ]
    },
    {
      "name": "vaultDeposited",
      "discriminator": [
        59,
        62,
        43,
        200,
        220,
        104,
        100,
        67
      ]
    },
    {
      "name": "vaultPoolInitialized",
      "discriminator": [
        143,
        158,
        172,
        117,
        104,
        23,
        142,
        38
      ]
    },
    {
      "name": "vaultWithdrawn",
      "discriminator": [
        238,
        9,
        219,
        172,
        188,
        77,
        72,
        104
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "notVaultOwner",
      "msg": "Signer is not the vault owner"
    },
    {
      "code": 6002,
      "name": "notCosigner",
      "msg": "Signer is not the registered cosigner"
    },
    {
      "code": 6003,
      "name": "insufficientFunds",
      "msg": "Insufficient funds"
    },
    {
      "code": 6004,
      "name": "paused",
      "msg": "Program is paused"
    }
  ],
  "types": [
    {
      "name": "betRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "betId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "game",
            "type": {
              "defined": {
                "name": "gameType"
              }
            }
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "multiplierBps",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "betSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "betId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "game",
            "type": {
              "defined": {
                "name": "gameType"
              }
            }
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "multiplierBps",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "claimRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "rewardKind"
              }
            }
          },
          {
            "name": "period",
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
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "gameType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "crash"
          },
          {
            "name": "coinflip"
          },
          {
            "name": "blackjack"
          },
          {
            "name": "lottery"
          },
          {
            "name": "jackpot"
          }
        ]
      }
    },
    {
      "name": "house",
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
            "name": "usdsMint",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rewardClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "rewardKind"
              }
            }
          },
          {
            "name": "period",
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
      "name": "rewardKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "wagerReward"
          },
          {
            "name": "cashback"
          },
          {
            "name": "dailyCase"
          },
          {
            "name": "airdrop"
          },
          {
            "name": "dividend"
          }
        ]
      }
    },
    {
      "name": "userVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userVaultPosition",
      "docs": [
        "A user's stake in one term pool (aggregated; one position per pool)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u128"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "maturesAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultAccrued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "indexRay",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "vaultDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u128"
          },
          {
            "name": "maturesAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultPool",
      "docs": [
        "A SCAD Vault term pool — share/index accounting + a $SCAD vault token account",
        "(the on-chain twin of the off-chain `VaultPool`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "scadMint",
            "type": "pubkey"
          },
          {
            "name": "termDays",
            "type": "u32"
          },
          {
            "name": "weightBps",
            "type": "u16"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u128"
          },
          {
            "name": "indexRay",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultPoolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "termDays",
            "type": "u32"
          },
          {
            "name": "weightBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "vaultWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u128"
          },
          {
            "name": "gross",
            "type": "u64"
          },
          {
            "name": "penalty",
            "type": "u64"
          },
          {
            "name": "net",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
