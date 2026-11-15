"""Allow executing the package directly via `python -m autoengine`."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
