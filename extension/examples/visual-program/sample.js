/* Offline bundle of graph.json and console.txt. Verified by programTrace.test.js. */
'use strict';
globalThis.ZephyrProgramRecording = {
  "graph": {
    "version": 1,
    "name": "thread_network",
    "creation": "static",
    "objects": [
      {
        "id": "samples",
        "name": "samples",
        "kind": "msgq",
        "capacity": 4
      },
      {
        "id": "ready",
        "name": "ready",
        "kind": "sem",
        "capacity": 1
      },
      {
        "id": "counter",
        "name": "counter",
        "kind": "mutex"
      }
    ],
    "functions": [
      {
        "id": "scale",
        "name": "scale",
        "steps": [
          {
            "id": "threshold",
            "op": "if",
            "test": "ge",
            "value": 40,
            "steps": [
              {
                "id": "double",
                "op": "multiply",
                "value": 2
              }
            ],
            "elseSteps": [
              {
                "id": "offset",
                "op": "add",
                "value": 1
              }
            ]
          }
        ]
      }
    ],
    "mainSteps": [
      {
        "id": "startup",
        "op": "set",
        "value": 1
      },
      {
        "id": "boot_output",
        "op": "print"
      },
      {
        "id": "twice",
        "op": "repeat",
        "count": 2,
        "steps": [
          {
            "id": "pause",
            "op": "delay",
            "value": 1
          },
          {
            "id": "each",
            "op": "add",
            "value": 3
          }
        ]
      },
      {
        "id": "boot_result",
        "op": "print"
      }
    ],
    "threads": [
      {
        "id": "sensor",
        "name": "sensor",
        "stack": 1024,
        "priority": 2,
        "initialValue": 42,
        "steps": [
          {
            "id": "publish",
            "op": "send",
            "object": "samples"
          }
        ]
      },
      {
        "id": "relay",
        "name": "relay",
        "stack": 1024,
        "priority": 3,
        "steps": [
          {
            "id": "read",
            "op": "receive",
            "object": "samples"
          },
          {
            "id": "process",
            "op": "call",
            "function": "scale"
          },
          {
            "id": "result",
            "op": "print"
          },
          {
            "id": "notify",
            "op": "give",
            "object": "ready"
          },
          {
            "id": "count",
            "op": "increment",
            "object": "counter"
          }
        ]
      },
      {
        "id": "logger",
        "name": "logger",
        "stack": 1024,
        "priority": 4,
        "steps": [
          {
            "id": "await_ready",
            "op": "take",
            "object": "ready"
          }
        ]
      }
    ]
  },
  "log": "*** Booting Zephyr OS build 25c8f4a23988 ***\nZVTRACE 2 d6617b87ac27451a $main startup - set 1\n$main value=1\nZVTRACE 2 d6617b87ac27451a $main boot_output - print 1\nZVTRACE 2 d6617b87ac27451a sensor publish samples send 42\nZVTRACE 2 d6617b87ac27451a relay read samples receive 42\nZVTRACE 2 d6617b87ac27451a relay process - call-enter 42\nZVTRACE 2 d6617b87ac27451a relay threshold - if-then 42\nZVTRACE 2 d6617b87ac27451a relay double - multiply 84\nZVTRACE 2 d6617b87ac27451a relay process - call-return 84\nrelay value=84\nZVTRACE 2 d6617b87ac27451a relay result - print 84\nZVTRACE 2 d6617b87ac27451a relay notify ready give 84\nZVTRACE 2 d6617b87ac27451a relay count counter increment 1\nZVTRACE 2 d6617b87ac27451a logger await_ready ready take 42\nZVTRACE 2 d6617b87ac27451a $main pause - delay 1\nZVTRACE 2 d6617b87ac27451a $main each - add 4\nZVTRACE 2 d6617b87ac27451a $main pause - delay 4\nZVTRACE 2 d6617b87ac27451a $main each - add 7\nZVTRACE 2 d6617b87ac27451a $main twice - repeat 7\n$main value=7\nZVTRACE 2 d6617b87ac27451a $main boot_result - print 7\n"
};
