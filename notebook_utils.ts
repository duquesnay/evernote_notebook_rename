import {Evernote} from 'evernote';

async function prefixNotebookNameIfNeeded(notebook: any, authenticatedClient: Evernote.Client) {
    let currentName = notebook.name;
    let stack_prefix = notebook.stack + '_';
    // if the notebook is already starting with the stack name, don't rename it
    if (!currentName.startsWith(stack_prefix)) {
        let newName = stack_prefix + currentName;
        notebook.name = newName;
        console.log(notebook.stack, '/', currentName, '\t->', notebook.stack, '/', newName);
        await authenticatedClient.getNoteStore().updateNotebook(notebook);
    } else {
        console.log(notebook.stack, '/', currentName, '\t-> skipping, already prefixed');
    }
}

export async function renameRemainingNotebooks(authenticatedClient: Evernote.Client) {
    const notebooks = await authenticatedClient.getNoteStore().listNotebooks();
    for (let notebook of notebooks) {
        if (notebook.stack) {
            await prefixNotebookNameIfNeeded(notebook, authenticatedClient);
        } else {
            console.log(notebook.name, '\t-> skipping, not in a stack');
        }

    }
}
