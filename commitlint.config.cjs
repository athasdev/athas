module.exports = {
  extends: [],
  rules: {
    // Basic message validation
    'header-min-length': [2, 'always', 3],
    'header-max-length': [2, 'always', 72],
    'header-case': [2, 'always', 'sentence-case'],
    'header-full-stop': [2, 'never', '.'],
    
    // Allow empty body and subject parsing issues
    'subject-empty': [0],
    'subject-case': [0],
    'subject-full-stop': [0],
    
    // Disable all conventional commit requirements
    'type-empty': [0],
    'type-enum': [0],
    'type-case': [0],
    'scope-empty': [0],
    'scope-case': [0],
    
    // Body rules (if present)
    'body-max-line-length': [1, 'always', 100],
    'body-leading-blank': [1, 'always']
  },
  
  // Parser options to handle simple messages
  parserPreset: {
    parserOpts: {
      headerPattern: /^(.*)$/,
      headerCorrespondence: ['subject']
    }
  }
}; 