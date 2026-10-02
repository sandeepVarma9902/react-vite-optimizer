import React, { useState } from 'react';
import { createEditor } from 'slate';
import { Slate, Editable, withReact } from 'slate-react';

export default function Editor() {
  const [editor] = useState(() => withReact(createEditor()));
  const [value, setValue] = useState([{ children: [{ text: 'Hello' }] }]);

  return (
    <Slate editor={editor} initialValue={value} onChange={setValue}>
      <Editable />
    </Slate>
  );
}
