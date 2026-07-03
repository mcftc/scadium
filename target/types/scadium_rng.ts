/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/scadium_rng.json`.
 */
export type ScadiumRng = {
  "address": "3cPWLMPmbu9z5dKmAxXBqMsW3Uo1JYV9SMM4UR68HQCm",
  "metadata": {
    "name": "scadiumRng",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Scadium shared on-chain RNG: commit→reveal + SlotHashes entropy for ALL games"
  },
  "instructions": [
    {
      "name": "initRng",
      "docs": [
        "One-time config: register the cosigner allowed to open/settle rounds."
      ],
      "discriminator": [
        128,
        10,
        13,
        125,
        25,
        105,
        125,
        91
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
                  114,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
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
      "name": "openRound",
      "docs": [
        "Cosigner opens a round: publishes the seed commitment + bound game params,",
        "and PINS a future slot whose hash will seed the reveal."
      ],
      "discriminator": [
        66,
        235,
        123,
        240,
        8,
        35,
        185,
        159
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true
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
          "name": "gameType",
          "type": "u8"
        },
        {
          "name": "roundId",
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
          "name": "gameParamsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "nonce",
          "type": "u32"
        },
        {
          "name": "targetSlot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleRound",
      "docs": [
        "Cosigner reveals the seed; the program re-derives `final_entropy` ITSELF",
        "from the PINNED slot's hash so the cosigner cannot grind the outcome by",
        "choosing when to reveal."
      ],
      "discriminator": [
        40,
        101,
        18,
        1,
        31,
        129,
        52,
        77
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  110,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true
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
          "name": "gameType",
          "type": "u8"
        },
        {
          "name": "roundId",
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
      "name": "rngConfig",
      "discriminator": [
        83,
        214,
        125,
        102,
        196,
        170,
        195,
        136
      ]
    },
    {
      "name": "round",
      "discriminator": [
        87,
        127,
        165,
        51,
        73,
        78,
        116,
        174
      ]
    }
  ],
  "events": [
    {
      "name": "roundOpened",
      "discriminator": [
        99,
        173,
        228,
        72,
        142,
        57,
        109,
        178
      ]
    },
    {
      "name": "roundSettled",
      "discriminator": [
        249,
        225,
        66,
        54,
        157,
        200,
        234,
        222
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
      "name": "wrongRound",
      "msg": "Round id / game type mismatch"
    },
    {
      "code": 6002,
      "name": "roundClosed",
      "msg": "Round is not open"
    },
    {
      "code": 6003,
      "name": "seedMismatch",
      "msg": "Revealed seed does not match the commitment"
    },
    {
      "code": 6004,
      "name": "targetSlotNotFuture",
      "msg": "Pinned target slot must be in the future"
    },
    {
      "code": 6005,
      "name": "targetSlotNotAvailable",
      "msg": "SlotHashes entry for the pinned slot is unavailable"
    }
  ],
  "types": [
    {
      "name": "rngConfig",
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
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "round",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameType",
            "type": "u8"
          },
          {
            "name": "roundId",
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
            "name": "gameParamsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "targetSlot",
            "type": "u64"
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
            "name": "status",
            "type": {
              "defined": {
                "name": "roundStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameType",
            "type": "u8"
          },
          {
            "name": "roundId",
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
            "name": "gameParamsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "targetSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "roundSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameType",
            "type": "u8"
          },
          {
            "name": "roundId",
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
            "name": "entropy",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "roundStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "settled"
          }
        ]
      }
    }
  ]
};
