(comment) @comment

(marginalia) @comment

[
  "SELECT"
  "FROM"
  "WHERE"
  "AND"
  "OR"
  "NOT"
  "IN"
  "IS"
  "NULL"
  "AS"
  "ON"
  "JOIN"
  "LEFT"
  "RIGHT"
  "INNER"
  "OUTER"
  "FULL"
  "CROSS"
  "NATURAL"
  "USING"
  "ORDER"
  "BY"
  "ASC"
  "DESC"
  "LIMIT"
  "OFFSET"
  "GROUP"
  "HAVING"
  "UNION"
  "ALL"
  "INTERSECT"
  "EXCEPT"
  "INSERT"
  "INTO"
  "VALUES"
  "UPDATE"
  "SET"
  "DELETE"
  "CREATE"
  "ALTER"
  "DROP"
  "TABLE"
  "INDEX"
  "VIEW"
  "DATABASE"
  "SCHEMA"
  "IF"
  "EXISTS"
  "NOT"
  "PRIMARY"
  "KEY"
  "FOREIGN"
  "REFERENCES"
  "CONSTRAINT"
  "UNIQUE"
  "CHECK"
  "DEFAULT"
  "AUTO_INCREMENT"
  "CASCADE"
  "RESTRICT"
  "BEGIN"
  "COMMIT"
  "ROLLBACK"
  "TRANSACTION"
  "GRANT"
  "REVOKE"
  "WITH"
  "RECURSIVE"
  "CASE"
  "WHEN"
  "THEN"
  "ELSE"
  "END"
  "LIKE"
  "BETWEEN"
  "DISTINCT"
  "TOP"
  "RETURNING"
  "CONFLICT"
  "DO"
  "NOTHING"
  "REPLACE"
  "TEMPORARY"
  "TEMP"
  "EXPLAIN"
  "ANALYZE"
  "VACUUM"
  "PRAGMA"
  "TRIGGER"
  "PROCEDURE"
  "FUNCTION"
  "RETURNS"
  "DECLARE"
  "FETCH"
  "CURSOR"
  "OPEN"
  "CLOSE"
  "DEALLOCATE"
] @keyword

[
  "TRUE"
  "FALSE"
] @constant.builtin

[
  "INT"
  "INTEGER"
  "BIGINT"
  "SMALLINT"
  "TINYINT"
  "FLOAT"
  "DOUBLE"
  "DECIMAL"
  "NUMERIC"
  "REAL"
  "VARCHAR"
  "CHAR"
  "TEXT"
  "BLOB"
  "DATE"
  "TIME"
  "TIMESTAMP"
  "DATETIME"
  "BOOLEAN"
  "BOOL"
  "SERIAL"
  "BIGSERIAL"
  "UUID"
  "JSON"
  "JSONB"
  "ARRAY"
  "BYTEA"
  "INTERVAL"
  "MONEY"
  "POINT"
  "LINE"
  "POLYGON"
  "CIDR"
  "INET"
  "MACADDR"
  "BIT"
  "XML"
  "ENUM"
] @type

(literal) @string
(number) @number

(identifier) @variable
(field
  (identifier) @property)

(function_call
  name: (identifier) @function)

(table_reference
  name: (identifier) @type)

(column_definition
  name: (identifier) @property)

[
  "="
  "!="
  "<>"
  "<"
  ">"
  "<="
  ">="
  "+"
  "-"
  "*"
  "/"
  "%"
  "||"
  "::"
] @operator

[
  "("
  ")"
] @punctuation.bracket

[
  ","
  ";"
  "."
] @punctuation.delimiter

(parameter) @variable.parameter
