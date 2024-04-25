# Evernote Notebook Renamer

## Description

This project is a utility for renaming Evernote notebooks. It prefixes the notebook name with the stack name if the notebook is part of a stack (left untouched if it's not). 
Note: 
- somewhere in there is an OAuth 1 workflow implementation for Evernote API meant for standalone scripts (opening a browser if needed, retrieving the access token through a single use local http server, etc.). Feel free to reuse / steal it
- in the future, the OA1 workflow becomes a separate npm package (if I'm going back to evernote)

## Installation

1. Clone this repository to your local machine.
2. Run `npm install` to install the necessary dependencies.

## Usage

1. Set up your Evernote API keys in a `.env` file in the project root. Use the `.env.example` file as a template.
2. Run the script with `npm start`.

## Contributing

Contributions are welcome. Please fork the repository and create a pull request with your changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
