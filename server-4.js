const crypto = require('crypto');

//some webserver libs
const express = require('express');
const bodyParser = require('body-parser');
const auth = require('basic-auth');

//promisification
const bluebird = require('bluebird');

//database connector
const redis = require('redis');
//make redis use promises
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

//create db client
const client = redis.createClient();

const port = process.env.NODE_PORT || 3002;

//make sure client connects correctly.
client.on("error", function (err) {
    console.log("Error in redis client.on: " + err);
});

const setUser = function(userObj){
	return client.hmsetAsync("user:"+userObj.id, userObj ).then(function(){
		console.log('Successfully created (or overwrote) user '+userObj.id);
	}).catch(function(err){
		console.error("WARNING: errored while attempting to create tester user account");
	});

}

//make sure the test user credentials exist
const userObj = {
	salt: new Date().toString(),
	id: 'teacher'
};
userObj.hash = crypto.createHash('sha256').update('testing'+userObj.salt).digest('base64');
//this is a terrible way to do setUser
//I'm not waiting for the promise to resolve before continuing
//I'm just hoping it finishes before the first request comes in attempting to authenticate
setUser(userObj);


//start setting up webserver
const app = express();

//decode request body using json
app.use(bodyParser.json());

//allow the API to be loaded from an application running on a different host/port
app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
        res.header('Access-Control-Expose-Headers', 'X-Total-Count');
		res.header('Access-Control-Allow-Methods', "PUT, DELETE, POST, GET, HEAD");
        next();
});

//protect our API
app.use(function(req,res,next){
	switch(req.method){
		case "GET":
		case "POST":
		case "PUT":
		case "DELETE":
			//extract the given credentials from the request
			const creds = auth(req);

			//{name: theUserName, pass:thepassword}

			client.hgetallAsync('user:'+creds.name).then((userObj)=>{

				if(!userObj){
					res.sendStatus(401)
					return
				}

				hash = crypto.createHash('sha256').update(creds.pass+userObj.salt).digest('base64');
	
				if(hash == userObj.hash)
					next()	

				else
			 	res.sendStatus(401)

			})
	
			//look up userObj using creds.name
			//TODO use creds.name to lookup the user object in the DB
			//use the userObj.salt and the creds.pass to generate a hash
			//compare the hash, if they match call next() and do not use res object
			//to send anything to client
			//if they dont or DB doesn't have the user or there's any other error use the res object
			//to return a 401 status code
			break;
		default:
			//maybe an options check or something
			next();
			break;
	}
});

//this takes a set of items and filters, sorts and paginates the items.
//it gets it's commands from queryArgs and returns a new set of items
const filterSortPaginate = (type, queryArgs, items) =>{
	let keys;

	//create an array of filterable/sortable keys
	if(type == 'student'){
		keys = ['id','name'];
	}else{
		keys = ['id','student_id','type','max','grade'];
	}

    const filterer = (item) =>{
        //substring.lowercase
        for(k of keys) {
            if (queryArgs[k]!=undefined){
                queryArgs[k] = queryArgs[k].toLowerCase()
                if(   (k.indexOf("name")!=-1)   &&   ((item[k].indexOf(queryArgs[k])!=undefined) || (item[k].indexOf(queryArgs[k])!=0))){
                    return false;
                }
                
            }
            else if(item[k].toLowerCase()!=queryArgs[k])
                return false
                }
        return true;
        
    };




		//loop through keys defined in above scope
			//if this key exists in queryArgs
			//and it's value doesnt match whats's on the item
			//don't keep the item (return false)

    //apply above function using Array.filterer
    items = items.filter(filterer);
    console.log('items after filter:',items)
    
    //always sort, default to sorting on id
    if(!queryArgs._sort){
        queryArgs._sort = 'id';
    }
    //make sure the column can be sorted
    let direction = 1;
    if(!queryArgs._order){
        queryArgs._order = 'asc';
    }
    if(queryArgs._order.toLowerCase() == 'desc'){
        direction = -1;
    }


	//comparator...given 2 items returns which one is greater
	//used to sort items
	//written to use queryArgs._sort as the key when comparing
	//TODO fill out the sorter function
    const sorter = (a,b)=>{
        //Note direction and queryArgs are available to us in the above scope
        let cmp = 1
        if(a[queryArgs._sort] < b[queryArgs._sort])
            cmp = -1
            else if(a[queryArgs._sort] == b[queryArgs._sort])
                cmp = 0
                
                
                cmp *= direction;
        return cmp;
        
        //compare a[queryArgs._sort] (case insensitive) to the same in b
        //save a variable with 1 if a is greater than b, -1 if less and 0 if equal
        
        //multiply by direction to reverse order and return the variable
        
    };

	//use apply the above comparator using Array.sort
	items.sort(sorter);
	console.log('items after sort:',items)
	//if we need to paginate
	if (queryArgs._start || queryArgs._end || queryArgs._limit) {
		//TODO: fill out this if statement
		//define a start and end variable
		//start defaults to 0, end defaults to # of items
        let start = 0
        let end = items.length
        if(queryArgs._start)
            start = parseInt(queryArgs._start)
            
            if(queryArgs._end)
                end  = parseInt(queryArgs._end)
                else if(queryArgs._limit)
                    end = start + parseInt(queryArgs._limit)
                    //console("-------end fater add ---:   ", end)
        items = items.slice(start,end)

	}

	console.log('items after pagination:',items)
	return items;
};

app.get('/students/:id',function(req,res){
	//TODO
	//Hint use hgetallAsync
	const id = req.params.id
	if (!id)
		return res.sendStatus(404)
	//{"id": "cbaker","name": "someone else", "_ref":"/students/cbaker"}
	const userObj = {
		id: id,
		_ref: "/students/" + id
	};

	client.hgetallAsync('student:' + id).then(function () {
		return res.json(userObj)
	})


});
app.get('/students',function(req,res){
	//TODO fill out the function
	//Hint: use smembersAsync, then an array of promises from hgetallAsync and
	//Promise.all to consolidate responses and filter sort paginate and 
	client.smembersAsync('students').then(stu=>{
		Promise.all(stu.map(arr=>{
			return client.hgetallAsync('student:' + arr)
		})).then(items=>{
			res.set('x-total-count', items.length)
			return res.json(filterSortPaginate('student', req.query || {}, items))
		
	})
})
	

});

app.post('/students',function(req,res){

	//Should accept a JSON request body
	if (!req.body || !req.body.id || !req.body.name)
		return res.sendStatus(400)
	const id = req.body.id
	const name = req.body.name;
	client.saddAsync('students', id).then(user => {
		if (user <= 0)
			return res.sendStatus(400)

      const userObj = {
      _ref: "/students/" + id,
      id: id
      };
      
      if (!req.body.id || !req.body.name) {
      return res.sendStatus(400)
      }
//TODO
		//Hint: use saddAsync and hmsetAsync
      client.hmsetAsync("student:" + id, userObj).then(function () {
            return res.json(userObj)
          }

		)
	})

});


app.delete('/students/:id',function(req,res){

	if(!req.params.id) 
		return res.sendStatus(404)

	if ((!req.body) || (!req.body.id) || (!req.body.name))
		return res.sendStatus(400)


	//Hint use a Promise.all of delAsync and sremAsync
});


app.put('/students/:id',function(req,res){
	//TODO
	if ((!req.body) || (!req.params.id))
		res.sendStatus(400)
	const id = req.params.id;
	const name = req.body.name
	client.hexistsAsync('students' + id, name).then(user => {
		if (!user)
			return res.sendStatus(400)
		//console.log(name)
		//{ "student_id": "some_username", "type": "quiz", "max": "12", "grade": "12" }
		const use = { name: name };

		client.hsetAsync('student:' + id, 'name', use.name).then(function () {
			return res.json(use)
		})
	})
});


app.post('/grades',function(req,res){

	if ((!req.body) || (!req.body.student_id) || (!req.body.type) || (!req.body.max) || (!req.body.grade))
			return res.sendStatus(400)

         client.incrAsync('grades').then(nextID => {
             console.log(nextID)
             if (nextID <= 0)
             return res.sendStatus(400)
             //console.log(nextID)
             const stu_grades = {
             id: ''+nextID,
             _ref: "/grades/" + nextID
             };
         
            client.hmsetAsync("grade:" + stu_grades.id, stu_grades).then(function () {
                        return res.json(stu_grades)
            })
         });
});


app.get('/grades/:id',function(req,res){

        const id = req.params.student_id;
        if(!id)
        return res.sendStatus(404)
        // { "student_id": "some_username", "type": "quiz", "max": "12",
        //"grade": "12", "_ref": "/grades/2", "id": "2" }
        const userObj = {
        student_id: req.body.student_id,
        type: req.body.type,
        max: req.body.max,
        grade: req.body.grade,
        _ref: "/grades/" + req.body.id,
        id:id
        };


        client.hgetallAsync("grade:" + req.params.id).then(getG=> {
        if(!getG)
            return res.sendStatus(400)
            
                return res.json(userObj)
        })
	//TODO
	//Hint use hgetallAsync
});
app.put('/grades/:id',function(req,res){


        let id = req.params.student_id;
        let type = req.body.type;
        let  max = req.body.max;
        let grade = req.body.grade;
        let	_ref = "/grades/" + req.body.id;
	if(!id)
		return res.sendStatus(404)

	if ((!req.body) || (!id)|| (!type) || (!max) || (!grade) || (!_ref))
		return res.sendStatus(400)

	client.hexistsAsync('grades' + id, max,grade).then(user => {
		if (!user)
			return res.sendStatus(400)

		const use = { 
			max: max,
			grade:grades, 
		}

		client.hmsetAsync("grade:" + id, use).then(function () {
			return res.json(use)
		})
	})

	});


app.delete('/grades/:id',function(req,res){
	//TODO
	//Hint use delAsync .....duh


	if (!req.params.id)
		return res.sendStatus(404)

});

app.get('/grades',function(req,res){

	client.smembersAsync('students').then(stu => {
		Promise.all(stu.map(arr => {
			return client.hgetallAsync('student:' + arr)
		})).then(items => {
			res.set('x-total-count', items.length)
			return res.json(filterSortPaginate('student', req.query || {}, items))

		})
	})
	//TODO
	//Hint use getAsync, hgetallAsync
	//and consolidate with Promise.all to filter, sort, paginate

});
app.delete('/db',function(req,res){
	client.flushallAsync().then(function(){
		//make sure the test user credentials exist
		const userObj = {
			salt: new Date().toString(),
			id: 'teacher'
		};
		userObj.hash = crypto.createHash('sha256').update('testing'+userObj.salt).digest('base64');
		//this is a terrible way to do setUser
		//I'm not waiting for the promise to resolve before continuing
		//I'm just hoping it finishes before the first request comes in attempting to authenticate
		setUser(userObj).then(()=>{
			res.sendStatus(200);
		});
	}).catch(function(err){
		res.status(500).json({error: err});
	});
});

app.listen(port, function () {
  console.log('Example app listening on port '+port+'!');
});
