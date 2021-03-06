const Loki = require('lokijs');

const _types = {
    ANY:        value => value,
    INTEGER:    value => value == null ? null : parseInt(Number(value)),
    FLOAT:      value => value == null ? null : parseFloat(Number(value)),
    STRING:     value => value == null ? null : value.toString(),
    BOOLEAN:    value => value == null ? null : Boolean(value),
    DATE:       value => value == null ? null : (value instanceof Date ? value : new Date(value))
};

class Jotnar extends Loki {
    /**
     * The main database class
     * @param {string} filename Name of the database
     * @param {object} options Loki options
     */
    constructor (filename, options) {
        super(filename, options);
        this.models = {};
    }

    /**
     * Defines a new model
     * @param {string} name Model's name
     * @param {object} definition Model's properties definitions
     * @param {(object|function)} definition.prop Property definition or type parsing function
     * @param {function} [definition.prop.type=Jotnar.TYPES.ANY] Type parsing function
     * @param {boolean} [definition.prop.allowNull=true] Set to false to not accept null
     * @param {boolean} [definition.prop.defaultValue=null] Default value to insert
     * @param {boolean} [definition.prop.unique=false] If the property is unique, will be
     * much faster to find items by it, so please turn it true if it's the case.
     * @param {(object|boolean)} [options=false] An Loki Collection configuration object, with the changes below.
     * Or a boolean, which will be equivalent to the allowExtraProperties property, as below.
     * Changes:
     * - added   property   'allowExtraProperties' - If more properties are passed to the insert
     * function, they should be ignored (false) or included (true)?
     * - removed property   'unique'
     * @param {boolean} [options.allowExtraProperties=false] If more properties are passed to
     * the insert function, they should be ignored (false) or included (true)?
     * 
     * @example
     * // db is an instance of Jotnar
     * db.define('modelName', {
     *     property1: db.TYPES.INTEGER,
     *     property2: {
     *         type: db.TYPES.ANY,
     *         allowNull: true,
     *         defaultValue: null
     *         unique: false
     *     }
     * }, true);
     * // another example
     * db.define('modelName2', {
     *     property1: db.TYPES.INTEGER,
     *     property2: {
     *         type: db.TYPES.ANY,
     *         allowNull: true,
     *         defaultValue: null
     *         unique: false
     *     }
     * }, { allowExtraProperties: true, autoUpdate: true });
     */
    define (name, definition, options) {
        let self = this;

        if (!options) options = {};
        else if (options === true) options = { allowExtraProperties: true };

        if (this.models[name])
            throw new Error(`Redefinition of model ${name}`);
        
        this.models[name] = {
            _collection: null,
            _unique: [],
            _scheme: {},
            _defaultObject: {},
            _nonStrict: options.allowExtraProperties
        };

        if (definition.meta) throw new Error("Declaration of reserved property 'meta' not allowed");
        if (definition.$loki) throw new Error("Declaration of reserved property '$loki' not allowed");

        for (let prop in definition) {
            if (typeof definition[prop] === 'object') {
                if (definition[prop].unique) this.models[name]._unique.push(prop);
                this.models[name]._scheme[prop] = {
                    parse: definition[prop].type || _types.ANY,
                    notNull: definition[prop].allowNull === false,
                };
                this.models[name]._defaultObject[prop] = typeof definition[prop].defaultValue === 'undefined' ? null : definition[prop].defaultValue;
            } else {
                this.models[name]._scheme[prop] = {
                    parse: definition[prop],
                    notNull: false
                };
                this.models[name]._defaultObject[prop] = null;
            }
        }

        this.models[name]._collection = this.getCollection(name);
        if (!this.models[name]._collection) {
            options.unique = this.models[name]._unique;
            this.models[name]._collection = this.addCollection(name, options);
        }
        this.models[name]._collection.uniqueNames = this.models[name]._unique;

        self.models[name]._collection._insert = self.models[name]._collection.insert;
        self.models[name]._collection._update = self.models[name]._collection.update;

        /**
         * Inserts an object or array of objects in the collection
         * @param {(object|object[])} object Object or array of objects to insert
         */
        function insert (object) {
            let objects = Array.isArray(object) ? object : [object];
            let listToInsert = [];
            for (let obj of objects) {
                let toInsert = JSON.parse(JSON.stringify(self.models[name]._defaultObject));
                for (let prop in obj) {
                    if (self.models[name]._scheme[prop]) {
                        toInsert[prop] = self.models[name]._scheme[prop].parse(obj[prop]);
                    } else if (self.models[name]._nonStrict) {
                        toInsert[prop] = obj[prop];
                    }
                }
                for (let prop in self.models[name]._defaultObject) {
                     // null == undefined
                    if (toInsert[prop] == null && self.models[name]._scheme[prop].notNull) {
                        throw new Error(`Not null constraint failed for property '${prop}' of collection '${name}'.`);
                    }
                }
                listToInsert.push(toInsert);
            }
            return self.models[name]._collection._insert(listToInsert);
        }
        self.models[name]._collection.insert = insert;

        /**
         * Updates an object or array of objects in the collection
         * @param {(object|object[])} object Object or array of objects to update
         */
        function update (object) {
            if (Array.isArray(object)) {
                return self.models[name]._collection._update(object);
            }

            let toUpdate = {};
            for (let prop in object) {
                if (self.models[name]._scheme[prop]) {
                    toUpdate[prop] = self.models[name]._scheme[prop].parse(object[prop]);
                } else if (self.models[name]._nonStrict) {
                    toUpdate[prop] = object[prop];
                }
            }
            for (let prop in self.models[name]._defaultObject) {
                    // null == undefined
                if (toUpdate[prop] == null && self.models[name]._scheme[prop].notNull) {
                    throw new Error(`Not null constraint failed for property '${prop}' of collection '${name}'.`);
                }
            }
            toUpdate.meta = object.meta;
            toUpdate.$loki = object.$loki;

            return self.models[name]._collection._update(toUpdate);
        }
        self.models[name]._collection.update = update;


        return this.models[name]._collection;
    }

    /**
     * Obtain an existing model
     * @param {string} name Model's name
     */
    getModel (name) {
        return this.models[name] ? this.models[name]._collection : null;
    }

    /**
     * serializeReplacer - used to prevent certain properties from being serialized
     *
     */
    serializeReplacer (key, value) {
        switch (key) {
            case 'autosaveHandle':
            case 'persistenceAdapter':
            case 'constraints':
            case 'ttl':
              return null;
            case 'models':
            case 'TYPES':
            case 'throttledSavePending':
            case 'throttledCallbacks':
              return undefined;
            default:
              return value;
            }
    }
}

Jotnar.TYPES = _types;

module.exports = Jotnar;
